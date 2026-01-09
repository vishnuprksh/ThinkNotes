
import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { getCopilotResponse } from '../services/geminiService';

interface ChatPanelProps {
  editorContent: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onUpdateDocument: (newContent: string, reason: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ editorContent, messages, setMessages, onUpdateDocument, onUndo, canUndo }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await getCopilotResponse([...messages, userMessage], editorContent);
      
      let chatContent = response.text;
      let isEdit = false;

      // Regular expression to find [[UPDATE: reason]] ... content ... [[/UPDATE]]
      const updatePattern = /\[\[UPDATE:\s*(.*?)\]\]([\s\S]*?)\[\[\/UPDATE\]\]/i;
      const match = chatContent.match(updatePattern);

      if (match) {
        const reason = match[1].trim() || "AI Refinement";
        const newContent = match[2].trim();
        
        onUpdateDocument(newContent, reason);
        isEdit = true;

        // Strip the protocol tags from the chat bubble
        chatContent = chatContent.replace(updatePattern, '').trim();
        
        if (!chatContent) {
          chatContent = `Checked and updated: ${reason}`;
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: chatContent || "Done.",
        timestamp: Date.now(),
        groundingUrls: response.urls,
        searchEntryPointHtml: response.searchEntryPointHtml,
        isEdit: isEdit
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting to my reasoning engine. Please try again.",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-l border-[#30363d] w-full">
      <div className="p-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]/50">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a2 2 0 11-4 0V4z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 19a2 2 0 10-4 0v1a2 2 0 104 0v-1z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19a2 2 0 11-4 0v1a2 2 0 114 0v-1z" />
            <circle cx="12" cy="12" r="3" strokeWidth={2} />
            <path d="M12 9V5M12 19v-4M9 12H5m14 0h-4" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
          ThinkNotes Agent
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30 uppercase tracking-wider font-bold">Flash</span>
          <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-wider font-bold">Grounded</span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth bg-[#0d1117]">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] w-16 h-16 rounded-2xl flex items-center justify-center mx-auto text-indigo-400 shadow-2xl border border-[#30363d] relative overflow-hidden group">
              <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <svg className="w-9 h-9 relative z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 4a2 2 0 114 0v1a2 2 0 11-4 0V4z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M18 19a2 2 0 10-4 0v1a2 2 0 104 0v-1z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 19a2 2 0 11-4 0v1a2 2 0 114 0v-1z" />
                <circle cx="12" cy="12" r="3" strokeWidth={1.5} />
                <path d="M12 9V5M12 19v-4M9 12H5m14 0h-4" strokeWidth={1} strokeLinecap="round" />
              </svg>
            </div>
            <div className="space-y-1">
               <p className="text-sm font-semibold text-[#f0f6fc]">ThinkNotes Copilot</p>
               <p className="text-xs text-[#8b949e] max-w-[220px] mx-auto leading-relaxed">I can research facts, update your document, or explain complex topics with real-time web access.</p>
            </div>
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[90%] rounded-2xl p-4 text-sm shadow-sm transition-all relative ${
              m.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-tr-none' 
                : m.role === 'system' 
                  ? 'bg-transparent border border-[#30363d] text-[#8b949e] italic text-xs py-2 px-4 rounded-lg'
                  : 'bg-[#161b22] border border-[#30363d] text-[#c9d1d9] rounded-tl-none'
            }`}>
              {m.isEdit && (
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#30363d]">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                    Factual Update
                  </div>
                  {idx === messages.length - 1 && canUndo && (
                    <button 
                      onClick={onUndo}
                      className="text-[10px] bg-red-900/30 text-red-400 px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-900/50 transition-colors uppercase font-bold"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              
              {m.searchEntryPointHtml && (
                <div 
                  className="mt-4 pt-4 border-t border-[#30363d] overflow-hidden" 
                  dangerouslySetInnerHTML={{ __html: m.searchEntryPointHtml }}
                />
              )}

              {m.groundingUrls && m.groundingUrls.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#30363d] space-y-1.5">
                  <p className="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">Research Sources</p>
                  <div className="flex flex-col gap-1.5">
                    {m.groundingUrls.map((url, uidx) => (
                      <a 
                        key={uidx} 
                        href={url.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-2 truncate group"
                      >
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        <span className="truncate group-hover:underline">{url.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex items-center gap-3 text-xs text-[#8b949e] pl-2">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
            </div>
            Researching and reasoning...
          </div>
        )}
      </div>

      <div className="p-4 bg-[#161b22]/80 backdrop-blur-md border-t border-[#30363d]">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Search and verify facts..."
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl py-3 px-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all resize-none h-20 placeholder:text-[#484f58]"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="absolute right-3 bottom-3 p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-[#30363d] disabled:text-[#8b949e] rounded-lg text-white transition-all shadow-lg hover:shadow-indigo-500/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
