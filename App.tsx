
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([{
    content: INITIAL_CONTENT,
    timestamp: Date.now(),
    description: "Initial Note"
  }]);

  const previousContent = useMemo(() => {
    if (checkpoints.length < 2) return INITIAL_CONTENT;
    return checkpoints[checkpoints.length - 2].content;
  }, [checkpoints]);

  // Sidebar Resize Logic
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 260 && newWidth < 800) {
        setSidebarWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    const saved = localStorage.getItem('thinknotes_content_v1');
    const savedWidth = localStorage.getItem('thinknotes_sidebar_width');
    if (saved) {
      setContent(saved);
      setCheckpoints([{
        content: saved,
        timestamp: Date.now(),
        description: "Restored Note"
      }]);
    }
    if (savedWidth) {
      setSidebarWidth(parseInt(savedWidth, 10));
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    localStorage.setItem('thinknotes_content_v1', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('thinknotes_sidebar_width', sidebarWidth.toString());
  }, [sidebarWidth]);

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

  // --- Export Logic ---
  const exportAsMD = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thinknote-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  const exportAsPDF = () => {
    setIsExportMenuOpen(false);
    const originalPreviewMode = isPreviewMode;
    const originalDiffMode = showDiff;
    
    setIsPreviewMode(true);
    setShowDiff(false);

    setTimeout(() => {
      window.print();
      setIsPreviewMode(originalPreviewMode);
      setShowDiff(originalDiffMode);
    }, 100);
  };

  const exportAsDOC = () => {
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export DOC</title></head><body>";
    const footer = "</body></html>";
    const sourceHTML = header + renderedMarkdown + footer;
    
    const blob = new Blob(['\ufeff', sourceHTML], {
      type: 'application/msword'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thinknote-${Date.now()}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  return (
    <div className={`flex h-screen w-full bg-[#0d1117] text-[#c9d1d9] overflow-hidden ${isResizing ? 'cursor-col-resize select-none' : ''}`}>
      <div id="main-view" className={`flex flex-col flex-1 min-w-0 transition-all duration-300`}>
        <header className="no-print h-14 border-b border-[#30363d] flex items-center justify-between px-4 bg-[#161b22] z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="relative group cursor-pointer">
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative w-8 h-8 bg-[#0d1117] border border-[#30363d] rounded-lg flex items-center justify-center shadow-lg group-hover:border-indigo-500/50 transition-colors">
                  <svg className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a2 2 0 11-4 0V4z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 19a2 2 0 10-4 0v1a2 2 0 104 0v-1z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19a2 2 0 11-4 0v1a2 2 0 114 0v-1z" />
                    <circle cx="12" cy="12" r="3" strokeWidth={2} />
                    <path d="M12 9V5M12 19v-4M9 12H5m14 0h-4" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <span className="font-bold text-base tracking-tight hidden sm:inline-block bg-clip-text text-transparent bg-gradient-to-r from-white to-[#8b949e]">ThinkNotes</span>
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
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#c9d1d9] hover:bg-[#21262d] border border-[#30363d] transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              {isExportMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl z-50 overflow-hidden py-1">
                  <button onClick={exportAsMD} className="w-full text-left px-4 py-2 text-xs hover:bg-[#21262d] transition-colors flex items-center gap-2">
                    <span className="w-4 text-center font-bold text-indigo-400">MD</span> Markdown (.md)
                  </button>
                  <button onClick={exportAsPDF} className="w-full text-left px-4 py-2 text-xs hover:bg-[#21262d] transition-colors flex items-center gap-2">
                    <span className="w-4 text-center font-bold text-red-400">PDF</span> PDF Document (.pdf)
                  </button>
                  <button onClick={exportAsDOC} className="w-full text-left px-4 py-2 text-xs hover:bg-[#21262d] transition-colors flex items-center gap-2">
                    <span className="w-4 text-center font-bold text-blue-400">DOC</span> Word Document (.doc)
                  </button>
                </div>
              )}
            </div>
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
              <div className="max-w-6xl mx-auto border border-[#30363d] rounded-lg overflow-hidden shadow-2xl">
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
            <div className="flex-1 overflow-y-auto bg-[#0d1117] flex justify-center">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full max-w-6xl bg-transparent p-6 sm:p-10 font-mono text-[14px] leading-relaxed focus:outline-none resize-none text-[#d1d5db] caret-indigo-500 min-h-full"
                spellCheck={false}
                placeholder="Start writing..."
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-[#0d1117]">
               <div id="markdown-container" className="max-w-6xl mx-auto markdown-body" dangerouslySetInnerHTML={{ __html: renderedMarkdown as string }} />
            </div>
          )}
        </main>
      </div>

      {isSidebarOpen && (
        <>
          <div 
            onMouseDown={startResizing}
            className={`no-print w-1 bg-[#30363d] hover:bg-indigo-500/50 cursor-col-resize transition-colors z-20 relative group ${isResizing ? 'bg-indigo-500' : ''}`}
          >
            <div className="absolute inset-y-0 -left-2 -right-2 z-10"></div>
          </div>
          <div 
            className="chat-panel-container h-full no-print bg-[#0d1117]" 
            style={{ width: `${sidebarWidth}px` }}
          >
            <ChatPanel 
              editorContent={content} 
              messages={messages} 
              setMessages={setMessages} 
              onUpdateDocument={handleUpdateDocument}
              onUndo={handleUndo}
              canUndo={checkpoints.length > 1}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default App;
