
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
      
      let finalText = response.text;
      let isEdit = false;

      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          if (fc.name === 'update_document') {
            const args = fc.args as { new_content: string; reason: string };
            onUpdateDocument(args.new_content, args.reason);
            isEdit = true;
            if (!finalText) {
              finalText = `Applied update: ${args.reason}`;
            }
          }
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: finalText || "Task complete.",
        timestamp: Date.now(),
        groundingUrls: response.urls,
        isEdit: isEdit
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I ran into an issue. Please try your request again.",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-l border-[#30363d] w-full max-w-md md:max-w-sm lg:max-w-md">
      <div className="p-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]/50">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          ThinkNotes Agent
        </h2>
        <span className="text-[10px] bg-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30 uppercase tracking-wider font-bold">AI Active</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth bg-[#0d1117]">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <div className="bg-[#161b22] w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-indigo-400 shadow-lg border border-[#30363d]">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <p className="text-sm text-[#8b949e] max-w-[200px] mx-auto italic">Describe what you want to write or research.</p>
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
                    Refined
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
              
              {m.groundingUrls && m.groundingUrls.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#30363d] space-y-1.5">
                  <p className="text-[10px] font-bold text-[#8b949e] uppercase tracking-wider">Research Grounding</p>
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
            ThinkNotes is reasoning...
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
            placeholder="Help me think through..."
            className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl py-3 px-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all resize-none h-20 placeholder:text-[#484f58]"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="absolute right-3 bottom-3 p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-[#30363d] disabled:text-[#8b949e] rounded-lg text-white transition-all shadow-lg hover:shadow-indigo-500/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
