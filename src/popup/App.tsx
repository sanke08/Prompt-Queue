import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Plus, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  RotateCcw,
  Command,
  Keyboard,
  X
} from 'lucide-react';
import type { QueueState, Task } from '../utils/messaging';
import { sendMessageToBackground } from '../utils/messaging';

const App: React.FC = () => {
  const [state, setState] = useState<QueueState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Initial fetch
    sendMessageToBackground({ type: 'GET_QUEUE_STATE' }).then(setState);

    // Listen for updates from background
    const listener = (message: any) => {
      if (message.type === 'QUEUE_STATE_UPDATED') {
        setState(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement === textareaRef.current || document.activeElement?.tagName === 'INPUT';

      // Shortcuts available everywhere
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (isInputFocused) {
          setPrompt('');
        }
        return;
      }

      // Shortcuts available only when NOT in input
      if (!isInputFocused && !showShortcuts) {
        switch (e.key.toLowerCase()) {
          case 's': // Start / Pause / Resume
            e.preventDefault();
            if (!state?.isRunning) {
              if (state?.tasks.filter(t => t.status === 'pending').length) handleStart();
            } else if (state?.isPaused) {
              handleResume();
            } else {
              handlePause();
            }
            break;
          case 'c': // Clear
            e.preventDefault();
            handleClear();
            break;
          case 'q': // Focus Input
            e.preventDefault();
            textareaRef.current?.focus();
            break;
          case 'j': // Select Next
          case 'arrowdown':
            e.preventDefault();
            setSelectedIndex(prev => Math.min((state?.tasks.length || 1) - 1, prev + 1));
            break;
          case 'k': // Select Previous
          case 'arrowup':
            e.preventDefault();
            setSelectedIndex(prev => Math.max(0, prev - 1));
            break;
          case 'x': // Delete Selected
            e.preventDefault();
            if (state?.tasks[selectedIndex]) {
              handleRemove(state.tasks[selectedIndex].id);
            }
            break;
          case '?': // Show Shortcuts
            e.preventDefault();
            setShowShortcuts(true);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state]);

  const handleAddPrompt = async () => {
    if (!prompt.trim()) return;
    await sendMessageToBackground({ type: 'ADD_TASK', payload: prompt });
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleStart = () => sendMessageToBackground({ type: 'START_QUEUE' });
  const handlePause = () => sendMessageToBackground({ type: 'PAUSE_QUEUE' });
  const handleResume = () => sendMessageToBackground({ type: 'RESUME_QUEUE' });
  const handleClear = () => sendMessageToBackground({ type: 'CLEAR_QUEUE' });
  const handleRemove = (id: string) => sendMessageToBackground({ type: 'REMOVE_TASK', payload: id });

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4 text-gray-400" />;
      case 'running': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      case 'done': return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />;
    }
  };

  if (!state) return <div className="p-4 text-center">Loading...</div>;

  return (
    <div className="flex flex-col h-full bg-chatgpt-main overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-chatgpt-border bg-chatgpt-sidebar flex justify-between items-center z-10 shadow-sm">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <div className="w-6 h-6 bg-green-500 rounded-sm flex items-center justify-center text-white text-xs font-bold shadow-sm">
            G
          </div>
          Queue Automator
        </h1>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setShowShortcuts(!showShortcuts)}
            className={`p-1.5 rounded-md transition-colors ${showShortcuts ? 'bg-green-500/20 text-green-400' : 'hover:bg-chatgpt-hover text-gray-400'}`}
            title="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button 
            onClick={handleClear}
            className="p-1.5 hover:bg-chatgpt-hover rounded-md text-gray-400 transition-colors focus:outline-none focus:ring-1 focus:ring-red-500"
            title="Clear Queue (C)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Shortcuts Overlay */}
      {showShortcuts && (
        <div className="absolute inset-0 z-50 bg-chatgpt-main/95 backdrop-blur-md p-6 flex flex-col animate-in fade-in zoom-in duration-200">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Command className="w-5 h-5 text-green-500" />
              Shortcuts
            </h2>
            <button 
              onClick={() => setShowShortcuts(false)}
              className="p-1.5 hover:bg-chatgpt-hover rounded-full text-gray-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="space-y-3 flex-1 overflow-y-auto pr-2">
            {[
              { keys: ['S'], desc: 'Start / Pause / Resume' },
              { keys: ['C'], desc: 'Clear entire queue' },
              { keys: ['Q'], desc: 'Focus prompt input' },
              { keys: ['J', 'K'], desc: 'Navigate queue (Vim style)' },
              { keys: ['X'], desc: 'Delete selected task' },
              { keys: ['?'], desc: 'Show this help' },
              { keys: ['Ctrl', 'Enter'], desc: 'Add prompt (from input)' },
              { keys: ['Esc'], desc: 'Back / Clear input' },
            ].map((s, i) => (
              <div key={i} className="flex justify-between items-center p-2.5 border border-chatgpt-border rounded-xl bg-chatgpt-sidebar/50">
                <span className="text-sm text-gray-300 font-medium">{s.desc}</span>
                <div className="flex gap-1">
                  {s.keys.map((k, j) => (
                    <kbd key={j} className="px-2 py-1 text-[10px] font-bold bg-chatgpt-border border-b-2 border-black/50 rounded-md text-white min-w-[24px] text-center">
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-center text-[10px] text-gray-500 font-medium uppercase tracking-widest">
            Press ESC to close
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Input Area */}
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            placeholder="Enter prompt..."
            className="w-full bg-chatgpt-sidebar border border-chatgpt-border rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 min-h-[80px] max-h-[200px] resize-none transition-all"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) handleAddPrompt();
            }}
          />
          <button
            onClick={handleAddPrompt}
            disabled={!prompt.trim()}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:hover:bg-green-600 py-2 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-green-500/50"
            title="Add to Queue (Ctrl+Enter)"
          >
            <Plus className="w-4 h-4" />
            Add to Queue
          </button>
        </div>

        {/* Queue List */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs text-gray-400 uppercase tracking-wider font-medium px-1">
            <span>Queue ({state.tasks.length})</span>
            {state.isRunning && (
              <span className="flex items-center gap-1 text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                {state.isPaused ? 'Paused' : 'Running'}
              </span>
            )}
          </div>
          
          <div className="space-y-2 pb-20">
            {state.tasks.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-chatgpt-border rounded-xl text-gray-500 text-sm">
                No prompts in queue
              </div>
            ) : (
              state.tasks.map((task, index) => (
                <div 
                  key={task.id}
                  className={`group relative border rounded-xl p-3 bg-chatgpt-sidebar transition-all duration-200 ${
                    index === selectedIndex && !textareaRef.current?.matches(':focus') ? 'ring-2 ring-green-500 border-transparent shadow-lg shadow-green-900/10' : 'border-chatgpt-border'
                  } ${
                    task.status === 'running' ? 'border-blue-500 ring-1 ring-blue-500/50' : 'hover:border-gray-500'
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5">{getStatusIcon(task.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-3 text-gray-200 break-words leading-relaxed">
                        {task.prompt}
                      </p>
                      {task.error && (
                        <p className="text-[10px] text-red-400 mt-1 italic">{task.error}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(task.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 hover:text-red-400 rounded transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Footer Controls */}
      <footer className="p-4 border-t border-chatgpt-border bg-chatgpt-sidebar/80 backdrop-blur-sm absolute bottom-0 left-0 right-0">
        {!state.isRunning ? (
          <button
            onClick={handleStart}
            disabled={state.tasks.filter(t => t.status === 'pending').length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all transform active:scale-[0.98] shadow-lg shadow-blue-900/20 focus:outline-none focus:ring-2 focus:ring-blue-400"
            title="Start Processing (S)"
          >
            <Play className="w-4 h-4 fill-current" />
            Start Processing
          </button>
        ) : (
          <div className="flex gap-2">
            {state.isPaused ? (
              <button
                onClick={handleResume}
                className="flex-1 bg-blue-600 hover:bg-blue-700 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-400"
                title="Resume (S)"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex-1 bg-yellow-600 hover:bg-yellow-700 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all transform active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-yellow-400"
                title="Pause (S)"
              >
                <Pause className="w-4 h-4 fill-current" />
                Pause
              </button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
};

export default App;
