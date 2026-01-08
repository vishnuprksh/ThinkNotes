
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import ChatPanel from './components/ChatPanel';
import { Message, Checkpoint } from './types';

const INITIAL_CONTENT = `# Welcome to ThinkNotes

This is your AI-augmented workspace for thinking and writing.

## What's unique?
- **Agentic Editing**: I don't just chat; I update your notes directly.
- **Deep Reasoning**: Powered by Gemini 3 Flash with advanced thinking capabilities.
- **Search Integration**: Real-time web research is built into my reasoning process.

| Feature | Support |
| :--- | :--- |
| **Markdown Preview** | ✅ |
| **Version History** | ✅ |
| **Search Grounding** | ✅ |

Ask me to: *"Write a summary of the benefits of AI for technical writing"* or *"Research current trends in edge computing and add them here"*.
`;

marked.setOptions({
  gfm: true,
  breaks: true,
});

const getDiff = (oldStr: string, newStr: string) => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const diff: { type: 'added' | 'removed' | 'unchanged'; content: string }[] = [];
  
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'unchanged', content: oldLines[i] });
      i++; j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
      diff.push({ type: 'added', content: newLines[j] });
      j++;
    } else if (i < oldLines.length) {
      diff.push({ type: 'removed', content: oldLines[i] });
      i++;
    }
  }
  return diff;
};

const App: React.FC = () => {
  const [content, setContent] = useState(INITIAL_CONTENT);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([{
    content: INITIAL_CONTENT,
    timestamp: Date.now(),
    description: "Initial Note"
  }]);

  const previousContent = useMemo(() => {
    if (checkpoints.length < 2) return INITIAL_CONTENT;
    return checkpoints[checkpoints.length - 2].content;
  }, [checkpoints]);

  useEffect(() => {
    const saved = localStorage.getItem('thinknotes_content_v1');
    if (saved) {
      setContent(saved);
      setCheckpoints([{
        content: saved,
        timestamp: Date.now(),
        description: "Restored Note"
      }]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('thinknotes_content_v1', content);
  }, [content]);

  const handleUpdateDocument = useCallback((newContent: string, reason: string) => {
    setCheckpoints(prev => [...prev, {
      content: newContent,
      timestamp: Date.now(),
      description: reason
    }]);
    setContent(newContent);
  }, []);

  const handleUndo = useCallback(() => {
    if (checkpoints.length <= 1) return;
    
    const newCheckpoints = [...checkpoints];
    const removed = newCheckpoints.pop();
    const last = newCheckpoints[newCheckpoints.length - 1];
    
    setContent(last.content);
    setCheckpoints(newCheckpoints);
    setShowDiff(false);
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content: `Reverted: ${removed?.description}`,
      timestamp: Date.now()
    }]);
  }, [checkpoints]);

  const diffResult = useMemo(() => getDiff(previousContent, content), [previousContent, content]);
  const renderedMarkdown = useMemo(() => {
    try {
      return marked.parse(content);
    } catch (e) {
      return content;
    }
  }, [content]);

  return (
    <div className="flex h-screen w-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden">
      <div className={`flex flex-col flex-1 min-w-0 transition-all duration-300`}>
        <header className="h-14 border-b border-[#30363d] flex items-center justify-between px-4 bg-[#161b22] z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
              </div>
              <span className="font-bold text-sm tracking-tight hidden sm:inline-block">ThinkNotes</span>
            </div>
            <div className="h-4 w-[1px] bg-[#30363d]"></div>
            <div className="flex gap-1 bg-[#0d1117] p-0.5 rounded-md border border-[#30363d]">
              <button 
                onClick={() => { setIsPreviewMode(true); setShowDiff(false); }}
                className={`px-3 py-1 rounded text-xs transition-colors ${(isPreviewMode && !showDiff) ? 'bg-[#21262d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                Preview
              </button>
              <button 
                onClick={() => { setIsPreviewMode(false); setShowDiff(false); }}
                className={`px-3 py-1 rounded text-xs transition-colors ${(!isPreviewMode && !showDiff) ? 'bg-[#21262d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                Edit
              </button>
              {checkpoints.length > 1 && (
                <button 
                  onClick={() => { setShowDiff(true); setIsPreviewMode(false); }}
                  className={`px-3 py-1 rounded text-xs transition-colors ${showDiff ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
                >
                  Diff
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {checkpoints.length > 1 && (
              <button
                onClick={handleUndo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-white hover:bg-red-900/20 border border-transparent hover:border-red-500/30 transition-all"
                title="Undo last AI edit"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                Undo
              </button>
            )}
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`p-2 rounded-lg transition-colors ${isSidebarOpen ? 'text-indigo-400 bg-indigo-900/20' : 'text-[#8b949e] hover:bg-[#21262d]'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </button>
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden flex bg-[#0d1117]">
          {showDiff ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 font-mono text-[13px] leading-relaxed bg-[#0d1117]">
              <div className="max-w-5xl mx-auto border border-[#30363d] rounded-lg overflow-hidden shadow-2xl">
                <div className="bg-[#161b22] px-4 py-2 border-b border-[#30363d] text-[10px] text-[#8b949e] uppercase font-bold tracking-widest flex justify-between items-center">
                  <span>Changes Comparison</span>
                  <button onClick={() => setShowDiff(false)} className="hover:text-white">Close</button>
                </div>
                {diffResult.map((line, idx) => (
                  <div key={idx} className={`flex ${
                    line.type === 'added' ? 'bg-emerald-900/20 text-emerald-300' : 
                    line.type === 'removed' ? 'bg-red-900/20 text-red-300 line-through decoration-red-500/50' : 
                    'text-[#8b949e]'
                  }`}>
                    <span className="w-12 text-right pr-4 select-none opacity-30 border-r border-[#30363d] mr-4">{idx + 1}</span>
                    <span className="whitespace-pre-wrap py-0.5">{line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}{line.content || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !isPreviewMode ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 w-full bg-transparent p-6 sm:p-10 font-mono text-[14px] leading-relaxed focus:outline-none resize-none text-[#d1d5db] caret-indigo-500"
              spellCheck={false}
              placeholder="Start writing..."
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-[#0d1117]">
               <div className="max-w-3xl mx-auto markdown-body" dangerouslySetInnerHTML={{ __html: renderedMarkdown as string }} />
            </div>
          )}
        </main>
      </div>

      {isSidebarOpen && (
        <ChatPanel 
          editorContent={content} 
          messages={messages} 
          setMessages={setMessages} 
          onUpdateDocument={handleUpdateDocument}
          onUndo={handleUndo}
          canUndo={checkpoints.length > 1}
        />
      )}
    </div>
  );
};

export default App;
