import React, { useState, useRef, useEffect } from 'react';
import { Message, TableData, GlobalState } from '../types';
import { getCopilotResponseStream } from '../services/geminiService';

interface ChatPanelProps {
  editorContent: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onUpdateDocument: (newContent: string, reason: string) => void;
  onUndo: () => void;
  canUndo: boolean;
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
  recordGlobalState: (description: string, overrides?: Partial<GlobalState>) => void;
}

const STAGES = [
  "Auditing Document Architecture",
  "Checking Database Schema constraints",
  "Fetching Real-time Web Context",
  "Evaluating Pipeline Logic",
  "Synthesizing Markdown Refinements"
];

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  editorContent, 
  messages, 
  setMessages, 
  onUpdateDocument, 
  onUndo, 
  canUndo, 
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
  recordGlobalState
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
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input, timestamp: Date.now() };
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

      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.thought) {
            fullThought += part.thought;
            setStreamingThought(fullThought);
          }
          if (part.text) {
            fullText += part.text;
            setStreamingContent(fullText);
          }
        }

        const metadata = chunk.candidates?.[0]?.groundingMetadata;
        if (metadata) {
          if (metadata.groundingChunks) {
            groundingUrls = metadata.groundingChunks
              .filter(c => c.web)
              .map(c => ({ title: c.web?.title || 'Source', uri: c.web?.uri || '' }));
          }
          if (metadata.searchEntryPoint?.htmlContent) {
            searchEntryPointHtml = metadata.searchEntryPoint.htmlContent;
          }
        }
      }
      
      let pendingWriter = writerScript;
      let pendingReader = readerScript;
      let pipelineUpdated = false;

      const writerPattern = /\[\[UPDATE_WRITER\]\]([\s\S]*?)\[\[\/UPDATE_WRITER\]\]/gi;
      const writerMatch = writerPattern.exec(fullText);
      if (writerMatch) {
        pendingWriter = writerMatch[1].trim();
        setWriterScript(pendingWriter);
        pipelineUpdated = true;
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `⚙️ Pipeline: Hydrating Writer...`, timestamp: Date.now() }]);
      }

      const readerPattern = /\[\[UPDATE_READER\]\]([\s\S]*?)\[\[\/UPDATE_READER\]\]/gi;
      const readerMatch = readerPattern.exec(fullText);
      if (readerMatch) {
        pendingReader = readerMatch[1].trim();
        setReaderScript(pendingReader);
        pipelineUpdated = true;
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `🔍 Pipeline: Mapping Reader...`, timestamp: Date.now() }]);
      }

      if (pipelineUpdated) {
        await handleSync({ writer: pendingWriter, reader: pendingReader });
        // recordGlobalState is called inside the doc update or if only scripts changed, we'd want a state record
        // But the agent usually does a doc update too.
      }

      let cleanedChat = fullText
        .replace(writerPattern, '')
        .replace(readerPattern, '')
        .trim();

      const updatePattern = /\[\[UPDATE:\s*(.*?)\]\]([\s\S]*?)\[\[\/UPDATE\]\]/i;
      const updateMatch = cleanedChat.match(updatePattern);
      let isEdit = false;
      if (updateMatch) {
        const reason = updateMatch[1].trim() || "AI Refinement";
        const newContent = updateMatch[2].trim();
        onUpdateDocument(newContent, reason); // App handles recording global state here
        isEdit = true;
        cleanedChat = cleanedChat.replace(updatePattern, '').trim();
        if (!cleanedChat) cleanedChat = `Document successfully transformed: ${reason}`;
      } else if (pipelineUpdated) {
        recordGlobalState('Pipeline Script Update', { writerScript: pendingWriter, readerScript: pendingReader });
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: cleanedChat || "Workflow cycle completed.",
        thought: fullThought,
        timestamp: Date.now(),
        groundingUrls,
        searchEntryPointHtml,
        isEdit: isEdit
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Agent workflow interrupted by internal error.", timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
      setStreamingThought('');
      setStreamingContent('');
    }
  };

  return (
    <div className="flex flex-col h-full border-l w-full" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
      <div className="p-4 border-b flex items-center justify-between" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <svg className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          <span style={{ color: 'var(--text-primary)' }}>Research Agent</span>
        </h2>
        <div className="flex items-center gap-1.5">
          {canUndo && (
            <button onClick={onUndo} title="Undo last agent action" className="p-1.5 rounded hover:bg-white/5 text-indigo-400 transition-all border border-transparent hover:border-indigo-500/20">
               <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
            </button>
          )}
          <span className="text-[8px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold uppercase tracking-wider">Multi-Agent Pipeline</span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-2xl border relative overflow-hidden group" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--accent-primary)' }}>
               <svg className="w-9 h-9 relative z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="space-y-1">
               <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>System Idle</p>
               <p className="text-xs max-w-[220px] mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Ready for document transformation and data research operations.</p>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.role === 'assistant' && m.thought && (
               <details className="mb-2 w-full max-w-[90%] group">
                  <summary className="text-[10px] font-bold uppercase tracking-widest cursor-pointer list-none py-1 px-3 border rounded-lg hover:bg-white/5 inline-flex items-center gap-2" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                    <svg className="w-3 h-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    Reasoning
                  </summary>
                  <div className="mt-2 p-3 rounded-lg border text-[11px] leading-relaxed italic bg-black/5" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                    {m.thought}
                  </div>
               </details>
            )}
            <div className={`max-w-[90%] rounded-2xl p-4 text-sm shadow-sm transition-all relative border ${m.role === 'user' ? 'text-white rounded-tr-none' : m.role === 'system' ? 'italic text-[10px] py-1 px-3 bg-black/10 border-transparent' : 'rounded-tl-none'}`} 
            style={{ 
              backgroundColor: m.role === 'user' ? 'var(--accent-primary)' : m.role === 'system' ? 'transparent' : 'var(--bg-secondary)',
              borderColor: m.role === 'system' ? 'transparent' : 'var(--border-primary)',
              color: m.role === 'assistant' ? 'var(--text-primary)' : m.role === 'user' ? '#ffffff' : 'var(--text-secondary)'
            }}>
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              {m.searchEntryPointHtml && <div className="mt-4 pt-4 border-t overflow-hidden" style={{ borderColor: 'var(--border-primary)' }} dangerouslySetInnerHTML={{ __html: m.searchEntryPointHtml }} />}
              {m.groundingUrls && m.groundingUrls.length > 0 && (
                <div className="mt-4 pt-4 border-t space-y-1.5" style={{ borderColor: 'var(--border-primary)' }}>
                  <div className="flex flex-col gap-1.5">{m.groundingUrls.map((url, uidx) => (
                    <a key={uidx} href={url.uri} target="_blank" rel="noopener noreferrer" className="text-xs hover:opacity-80 flex items-center gap-2 truncate" style={{ color: 'var(--accent-primary)' }}>
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      <span className="truncate hover:underline">{url.title}</span>
                    </a>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex flex-col gap-4 max-w-[90%]">
             {streamingThought && (
               <div className="p-3 rounded-lg border border-dashed text-[11px] leading-relaxed italic bg-black/5 animate-pulse" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-primary)' }}>
                 <div className="font-bold uppercase tracking-widest text-[9px] mb-1">Streaming Reasoner:</div>
                 {streamingThought}
               </div>
             )}
             
             {streamingContent && (
                <div className="p-4 rounded-2xl rounded-tl-none border text-sm" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                   <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
                </div>
             )}

             {!streamingContent && !streamingThought && (
               <div className="flex items-center gap-4 p-4 rounded-2xl border bg-black/5" style={{ borderColor: 'var(--border-primary)' }}>
                  <div className="relative w-8 h-8 flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-2 border-t-indigo-500 rounded-full animate-spin"></div>
                    <svg className="w-4 h-4 text-indigo-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse">
                      {STAGES[currentStageIndex]}
                    </span>
                    <span className="text-[9px] text-theme-muted">Constructing inference chain...</span>
                  </div>
               </div>
             )}
          </div>
        )}
      </div>

      <div className="p-4 border-t" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
        <div className="relative">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Instruct the research agent..." className="w-full border rounded-xl py-3 px-4 pr-12 text-sm focus:outline-none focus:ring-1 transition-all resize-none h-20"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }} />
          <button onClick={handleSend} disabled={isLoading || !input.trim()} className="absolute right-3 bottom-3 p-2 rounded-lg text-white transition-all shadow-lg"
            style={{ backgroundColor: !isLoading && input.trim() ? 'var(--accent-primary)' : '#30363d' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;