
import React, { useState, useRef, useEffect } from 'react';
import { Message, TableData, GlobalState } from '../types';
import { getCopilotResponseStream } from '../services/geminiService';

interface ChatPanelProps {
  editorContent: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onUpdateDocument: (newContent: string, reason: string) => void;
  restoreCheckpoint: (index: number) => void;
  dbSchema: string;
  executeSql: (sql: string) => { data?: any; error?: string };
  fetchExternalData: (url: string, method?: string) => Promise<{ data?: any; error?: string }>;
  setAllVariables: (vars: Record<string, string | TableData>) => void;
  variables: Record<string, string | TableData>;
  writerScript: string;
  setWriterScript: (script: string) => void;
  readerScript: string;
  setReaderScript: (script: string) => void;
  handleSync: (scripts?: { writer?: string; reader?: string }) => Promise<void>;
  recordGlobalState: (description: string, overrides?: Partial<GlobalState>) => number;
  onCloseMobile?: () => void;
}

const STAGES = [
  "Analyzing Document",
  "Checking Context",
  "Researching",
  "Synthesizing Information",
  "Applying Updates"
];

const ChatPanel: React.FC<ChatPanelProps> = ({
  editorContent,
  messages,
  setMessages,
  onUpdateDocument,
  restoreCheckpoint,
  dbSchema,
  executeSql,
  fetchExternalData,
  setAllVariables,
  variables,
  writerScript,
  setWriterScript,
  readerScript,
  setReaderScript,
  handleSync,
  recordGlobalState,
  onCloseMobile
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [streamingThought, setStreamingThought] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading, streamingContent, streamingThought]);

  useEffect(() => {
    let interval: number;
    if (isLoading) {
      interval = window.setInterval(() => {
        setCurrentStageIndex((prev) => (prev + 1) % STAGES.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'user', content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingThought('');
    setStreamingContent('');
    setCurrentStageIndex(0);

    try {
      const currentVarsString = Object.entries(variables)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : '[Table]'}`)
        .join(', ');

      const stream = await getCopilotResponseStream(
        [...messages, userMsg],
        editorContent,
        dbSchema,
        currentVarsString,
        writerScript,
        readerScript
      );

      let fullText = "";
      let fullThought = "";
      let groundingUrls: any[] = [];
      let searchEntryPointHtml = "";

      for await (const chunk of stream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        setStreamingContent(fullText);
      }

      let pendingWriter = writerScript;
      let pendingReader = readerScript;
      let pipelineUpdated = false;

      const writerPattern = /\[\[UPDATE_WRITER\]\]([\s\S]*?)\[\[\/UPDATE_WRITER\]\]/gi;
      const writerMatch = writerPattern.exec(fullText);
      if (writerMatch) {
        pendingWriter = writerMatch[1].trim().replace(/^```(javascript|js)?\s*/, '').replace(/```\s*$/, '');
        setWriterScript(pendingWriter);
        pipelineUpdated = true;
        setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'system', content: `⚙️ Assistant: Absorbing Information...`, timestamp: Date.now() }]);
      }

      const readerPattern = /\[\[UPDATE_READER\]\]([\s\S]*?)\[\[\/UPDATE_READER\]\]/gi;
      const readerMatch = readerPattern.exec(fullText);
      if (readerMatch) {
        pendingReader = readerMatch[1].trim().replace(/^```(javascript|js)?\s*/, '').replace(/```\s*$/, '');
        setReaderScript(pendingReader);
        pipelineUpdated = true;
        setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'system', content: `🔍 Assistant: Organizing Knowledge...`, timestamp: Date.now() }]);
      }

      let finalVariables = variables;
      if (pipelineUpdated) {
        const resultVars = await handleSync({ writer: pendingWriter, reader: pendingReader });
        if (resultVars) finalVariables = resultVars;
      }

      let cleanedChat = fullText
        .replace(writerPattern, '')
        .replace(readerPattern, '')
        .trim();

      const updatePattern = /\[\[UPDATE:\s*(.*?)\]\]([\s\S]*?)\[\[\/UPDATE\]\]/i;
      const updateMatch = cleanedChat.match(updatePattern);
      let isEdit = false;
      let reason = "Assistant Response";
      let finalContent = editorContent;

      // Helper to strip technical jargon
      const filterJargon = (text: string) => {
        const forbiddenPatterns = [
          /db\.run/i, /db\.exec/i, /INSERT INTO/i, /CREATE TABLE/i, /SELECT .* FROM/i,
          /sqlite/i, /Foreign Key/i, /Internal Writer/i, /Internal Reader/i,
          /database schema/i, /primary key/i,
          // Aggressive filtering for AI workflow artifacts
          /^#{3,4}\s+\d+\.\s+.*$/i, // ### 1. DRAFTING, ### 2. MEMORY AUDIT
          /^#{3,4}\s+Updating\s+(READER|WRITER).*$/i,
          /PIPELINE SYNTHESIS/i, /DATA AUDIT/i, /FINAL TRANSFORMATION/i,
          /The WRITER remains unchanged/i,
          /I will query '.*' for/i
        ];
        return text.split('\n')
          .filter(line => !forbiddenPatterns.some(p => p.test(line)))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines left by filtering
          .trim();
      };

      if (updateMatch) {
        reason = updateMatch[1].trim() || "Assistant Refinement";
        // CRITICAL: Strip markdown code blocks if the AI wrapped the content in them
        let rawContent = updateMatch[2].trim()
          .replace(/^```[a-z]*\s*/i, '') // Remove leading ```markdown
          .replace(/```\s*$/, '');        // Remove trailing ```

        // Filter jargon from the document content as well
        finalContent = filterJargon(rawContent);

        onUpdateDocument(finalContent, reason);
        isEdit = true;
        cleanedChat = cleanedChat.replace(updatePattern, '').trim();
        if (!cleanedChat) cleanedChat = `Assistant applied changes: ${reason}`;
      }

      // CRITICAL: We record the global state AFTER all potential updates (Scripts + Content)
      // to ensure the checkpoint represents the state RESULTING from this message.
      const checkpointIndex = recordGlobalState(reason, {
        content: finalContent,
        writerScript: pendingWriter,
        readerScript: pendingReader,
        variables: finalVariables
      });

      const assistantMessage: Message = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: filterJargon(cleanedChat) || "I've updated your workspace with the requested changes.",
        thought: fullThought,
        timestamp: Date.now(),
        groundingUrls,
        searchEntryPointHtml,
        isEdit: isEdit,
        checkpointIndex: checkpointIndex
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, role: 'assistant', content: "Assistant encountered an internal error.", timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
      setStreamingThought('');
      setStreamingContent('');
    }
  };

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
      <div className="p-3 sm:p-4 border-b flex items-center justify-between" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-2">
          {onCloseMobile && (
            <button onClick={onCloseMobile} className="lg:hidden p-1.5 rounded hover:bg-white/5 mr-1" style={{ color: 'var(--text-secondary)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" style={{ color: 'var(--accent-primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span style={{ color: 'var(--text-primary)' }}>Assistant</span>
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={async () => {
              setMessages([]);
              await handleSync();
            }}
            title="Start New Chat"
            className="p-1 px-2 rounded border text-[9px] font-bold uppercase tracking-wider transition-all hover:bg-white/5 active:scale-95 flex items-center gap-1.5"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Chat
          </button>
          <span className="text-[8px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold uppercase tracking-wider hidden xs:inline-block">Checkpoint Mode</span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 sm:space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="text-center py-10 sm:py-12 space-y-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mx-auto shadow-2xl border relative overflow-hidden group" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--accent-primary)' }}>
              <svg className="w-8 h-8 sm:w-9 sm:h-9 relative z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="space-y-1 px-4">
              <p className="text-xs sm:text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Waiting for instructions</p>
              <p className="text-[10px] sm:text-xs max-w-[220px] mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>I can help you research, organize data, or transform this document.</p>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.role === 'assistant' && m.thought && (
              <details className="mb-2 w-full max-w-[95%] sm:max-w-[90%] group">
                <summary className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest cursor-pointer list-none py-1 px-2.5 sm:px-3 border rounded-lg hover:bg-white/5 inline-flex items-center gap-2" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                  <svg className="w-2.5 h-2.5 sm:w-3 h-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  Reasoning
                </summary>
                <div className="mt-2 p-2.5 sm:p-3 rounded-lg border text-[10px] sm:text-[11px] leading-relaxed italic bg-black/5" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                  {m.thought}
                </div>
              </details>
            )}
            <div className={`max-w-[95%] sm:max-w-[90%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm shadow-sm transition-all relative border ${m.role === 'user' ? 'text-white rounded-tr-none' : m.role === 'system' ? 'italic text-[9px] sm:text-[10px] py-1 px-2.5 sm:px-3 bg-black/10 border-transparent' : 'rounded-tl-none'}`}
              style={{
                backgroundColor: m.role === 'user' ? 'var(--accent-primary)' : m.role === 'system' ? 'transparent' : 'var(--bg-secondary)',
                borderColor: m.role === 'system' ? 'transparent' : 'var(--border-primary)',
                color: m.role === 'assistant' ? 'var(--text-primary)' : m.role === 'user' ? '#ffffff' : 'var(--text-secondary)'
              }}>
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>

              {m.role === 'assistant' && m.checkpointIndex !== undefined && (
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => restoreCheckpoint(m.checkpointIndex!)}
                    className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20 transition-all flex items-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                    Restore Point
                  </button>
                </div>
              )}

              {m.searchEntryPointHtml && <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t overflow-hidden" style={{ borderColor: 'var(--border-primary)' }} dangerouslySetInnerHTML={{ __html: m.searchEntryPointHtml }} />}
              {m.groundingUrls && m.groundingUrls.length > 0 && (
                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t space-y-1.5" style={{ borderColor: 'var(--border-primary)' }}>
                  <div className="flex flex-col gap-1.5">{m.groundingUrls.map((url, uidx) => (
                    <a key={uidx} href={url.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] sm:text-xs hover:opacity-80 flex items-center gap-2 truncate" style={{ color: 'var(--accent-primary)' }}>
                      <svg className="w-3 h-3 sm:w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      <span className="truncate hover:underline">{url.title}</span>
                    </a>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex flex-col gap-3 sm:gap-4 max-w-[95%] sm:max-w-[90%]">
            {streamingThought && (
              <div className="p-2.5 sm:p-3 rounded-lg border border-dashed text-[10px] sm:text-[11px] leading-relaxed italic bg-black/5 animate-pulse" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                <div className="font-bold uppercase tracking-widest text-[8px] sm:text-[9px] mb-1">Inference:</div>
                {streamingThought}
              </div>
            )}

            {streamingContent && (
              <div className="p-3 sm:p-4 rounded-2xl rounded-tl-none border text-xs sm:text-sm" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
              </div>
            )}

            {!streamingContent && !streamingThought && (
              <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl border bg-black/5" style={{ borderColor: 'var(--border-primary)' }}>
                <div className="relative w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center shrink-0">
                  <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full"></div>
                  <div className="absolute inset-0 border-2 border-t-indigo-500 rounded-full animate-spin"></div>
                  <svg className="w-3 h-3 sm:w-4 h-4 text-indigo-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] sm:text-[10px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse">
                    {STAGES[currentStageIndex]}
                  </span>
                  <span className="text-[8px] sm:text-[9px] text-theme-muted">Assistant is working...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4 border-t" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
        <div className="relative">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask anything..." className="w-full border rounded-xl py-2.5 sm:py-3 px-3 sm:px-4 pr-10 sm:pr-12 text-xs sm:text-sm focus:outline-none focus:ring-1 transition-all resize-none h-16 sm:h-20"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }} />
          <button onClick={handleSend} disabled={isLoading || !input.trim()} className="absolute right-2.5 bottom-2.5 p-1.5 sm:p-2 rounded-lg text-white transition-all shadow-lg"
            style={{ backgroundColor: !isLoading && input.trim() ? 'var(--accent-primary)' : '#30363d' }}>
            <svg className="w-3.5 h-3.5 sm:w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
