import React, { useState, useEffect, useRef } from "react";
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
  X,
  Link,
  Link2,
  Unlink,
} from "lucide-react";
import type { QueueState, Task } from "../utils/messaging";
import { sendMessageToBackground } from "../utils/messaging";

const App: React.FC = () => {
  const [state, setState] = useState<QueueState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isListActive, setIsListActive] = useState(false);
  const [isLockedToTab, setIsLockedToTab] = useState(false);
  const [currentTab, setCurrentTab] = useState<{
    id: number;
    url: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus prompt input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Initial fetch
    sendMessageToBackground({ type: "GET_QUEUE_STATE" }).then(setState);

    // Get current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (
        tab?.url &&
        (tab.url.includes("chatgpt.com") || tab.url.includes("chat.openai.com"))
      ) {
        setCurrentTab({ id: tab.id!, url: tab.url });
      }
    });

    // Listen for updates from background
    const listener = (message: any) => {
      if (message.type === "QUEUE_STATE_UPDATED") {
        setState(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused =
        document.activeElement === textareaRef.current ||
        document.activeElement?.tagName === "INPUT";

      // Shortcuts available everywhere
      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (isInputFocused) {
          setPrompt("");
        }
        return;
      }

      // Shortcuts available only when NOT in input
      if (!isInputFocused && !showShortcuts) {
        switch (e.key.toLowerCase()) {
          case "s": // Start / Pause / Resume
            e.preventDefault();
            if (!state?.isRunning) {
              if (state?.tasks.filter((t) => t.status === "pending").length)
                handleStart();
            } else if (state?.isPaused) {
              handleResume();
            } else {
              handlePause();
            }
            break;
          case "c": // Clear
            e.preventDefault();
            handleClear();
            break;
          case "i": // Focus Input (Insert mode)
            e.preventDefault();
            setIsListActive(false);
            textareaRef.current?.focus();
            break;
          case "j": // Select Next
          case "arrowdown":
            e.preventDefault();
            setIsListActive(true);
            setSelectedIndex((prev) =>
              Math.min((state?.tasks.length || 1) - 1, prev + 1),
            );
            break;
          case "k": // Select Previous
          case "arrowup":
            e.preventDefault();
            setIsListActive(true);
            setSelectedIndex((prev) => Math.max(0, prev - 1));
            break;
          case "delete": // Delete Selected
            e.preventDefault();
            if (state?.tasks[selectedIndex]) {
              handleRemove(state.tasks[selectedIndex].id);
            }
            break;
          case "?": // Show Shortcuts
            e.preventDefault();
            setShowShortcuts(true);
            break;
        }
      }

      // Alt + L: Toggle Lock to Tab
      if (e.altKey && e.code === "KeyL") {
        e.preventDefault();
        if (currentTab) {
          const newLocked = !isLockedToTab;
          setIsLockedToTab(newLocked);
          if (newLocked) setTargetUrl(currentTab.url);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state]);

  const handleAddPrompt = async () => {
    if (!prompt.trim()) return;
    const finalTargetUrl =
      targetUrl.trim() || (isLockedToTab ? currentTab?.url : undefined);
    await sendMessageToBackground({
      type: "ADD_TASK",
      payload: { prompt, targetUrl: finalTargetUrl },
    });
    setPrompt("");
    setTargetUrl("");
    setIsLockedToTab(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleStart = () => sendMessageToBackground({ type: "START_QUEUE" });
  const handlePause = () => sendMessageToBackground({ type: "PAUSE_QUEUE" });
  const handleResume = () => sendMessageToBackground({ type: "RESUME_QUEUE" });
  const handleClear = () => sendMessageToBackground({ type: "CLEAR_QUEUE" });
  const handleRemove = (id: string) =>
    sendMessageToBackground({ type: "REMOVE_TASK", payload: id });

  const getStatusIcon = (status: Task["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="w-4 h-4 text-mono-secondary" />;
      case "running":
        return <Loader2 className="w-4 h-4 text-mono-primary animate-spin" />;
      case "done":
        return <CheckCircle2 className="w-4 h-4 text-mono-primary" />;
      case "error":
        return <XCircle className="w-4 h-4 text-mono-secondary opacity-50" />;
    }
  };

  if (!state) return <div className="p-4 text-center">Loading...</div>;

  return (
    <div className="flex flex-col h-screen bg-mono-main overflow-hidden text-mono-primary selection:bg-white selection:text-black">
      {/* Header */}
      <header className="p-5 py-2 border-b border-mono bg-mono-sidebar flex justify-between items-center z-10 shadow-sm">
        <h1 className="text-sm font-bold tracking-tighter uppercase flex items-center gap-2">
          <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center text-black text-[10px] font-black">
            Q
          </div>
          Queue Automator
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className={`p-1.5 rounded-lg transition-all duration-200 ${showShortcuts ? "bg-white text-black" : "hover:bg-mono-hover text-mono-secondary"}`}
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            className="p-1.5 hover:bg-mono-hover rounded-lg text-mono-secondary transition-colors focus:outline-none focus:ring-1 focus:ring-white"
            title="Clear Queue (C)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Shortcuts Overlay */}
      {showShortcuts && (
        <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-xl p-8 flex flex-col animate-in fade-in zoom-in duration-300">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
              <Command className="w-4 h-4" />
              Shortcuts
            </h2>
            <button
              onClick={() => setShowShortcuts(false)}
              className="p-1.5 hover:bg-mono-hover rounded-full text-mono-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto pr-2 custom-scroll">
            {[
              { keys: ["S"], desc: "Start / Pause / Resume" },
              { keys: ["C"], desc: "Clear entire queue" },
              { keys: ["I"], desc: "Focus prompt input" },
              { keys: ["J", "K"], desc: "Navigate queue" },
              { keys: ["Delete"], desc: "Delete selected task" },
              { keys: ["?"], desc: "Show this help" },
              { keys: ["Alt", "L"], desc: "Toggle Lock to Current Tab" },
              { keys: ["Enter"], desc: "Add prompt (from input)" },
              { keys: ["Shift", "Enter"], desc: "New line in input" },
              { keys: ["Esc"], desc: "Back / Clear input" },
            ].map((s, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3.5 border border-mono rounded-lg bg-mono-sidebar/40 hover:bg-mono-sidebar transition-colors"
              >
                <span className="text-[11px] text-mono-secondary font-medium tracking-wide uppercase">
                  {s.desc}
                </span>
                <div className="flex gap-1.5">
                  {s.keys.map((k, j) => (
                    <kbd
                      key={j}
                      className="px-2 py-1 text-[9px] font-black bg-white text-black rounded shadow-[2px_2px_0px_rgba(255,255,255,0.2)]"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center text-[9px] text-mono-secondary font-black uppercase tracking-[0.3em] opacity-40">
            Esc to close
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex-1 flex flex-col min-h-0 ">
        {/* Fixed Input Area */}
        <div className="p-5 py-2 space-y-3 border-b border-mono bg-mono-main z-10">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] text-mono-secondary font-black uppercase tracking-[0.2em]">
              Add Prompt
            </span>
            {currentTab && (
              <button
                onClick={() => {
                  const newLocked = !isLockedToTab;
                  setIsLockedToTab(newLocked);
                  if (newLocked) setTargetUrl(currentTab.url);
                  else setTargetUrl("");
                }}
                className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all uppercase tracking-tighter ${
                  isLockedToTab
                    ? "bg-white text-black"
                    : "bg-mono-sidebar text-mono-secondary border border-mono"
                }`}
              >
                {isLockedToTab ? (
                  <Link2 className="w-3 h-3" />
                ) : (
                  <Unlink className="w-3 h-3" />
                )}
                {isLockedToTab ? "Locked" : "Any Chat"}
              </button>
            )}
          </div>

          {isLockedToTab && (
            <div className="flex items-center gap-2 px-3 py-2 bg-mono-sidebar border border-mono rounded-lg animate-in slide-in-from-top-2 duration-300">
              <Link className="w-3 h-3 text-mono-secondary shrink-0" />
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="chatgpt.com/c/..."
                className="flex-1 bg-transparent border-none text-[10px] text-mono-primary focus:outline-none focus:ring-0 placeholder:text-neutral-700 font-mono"
              />
            </div>
          )}

          <div className="relative group">
            <textarea
              ref={textareaRef}
              autoFocus
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              placeholder="Type your prompt..."
              className="w-full bg-mono-sidebar border border-mono rounded-lg p-4 text-xs focus:outline-none focus:border-white min-h-[80px] max-h-[160px] resize-none transition-all shadow-inner leading-relaxed placeholder:text-neutral-700"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddPrompt();
                }
              }}
            />
            <div className="absolute bottom-3 right-3 text-[9px] font-black text-mono-secondary opacity-20 group-focus-within:opacity-40 uppercase tracking-tighter transition-opacity">
              Enter
            </div>
          </div>
          <button
            onClick={handleAddPrompt}
            disabled={!prompt.trim()}
            className="w-full bg-white hover:bg-neutral-200 disabled:opacity-20 disabled:hover:bg-white text-black py-3 rounded-lg flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all transform active:scale-[0.98] shadow-lg shadow-black/50"
            title="Add to Queue (Enter)"
          >
            <Plus className="w-4 h-4 stroke-[3px]" />
            Add to Queue
          </button>
        </div>

        {/* Scrollable Queue List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scroll">
          <div className="flex justify-between items-center text-[10px] text-mono-secondary font-black uppercase tracking-[0.2em] px-1 mb-2">
            <span>Queue ({state.tasks.length})</span>
            {state.isRunning && (
              <span className="flex items-center gap-2 text-white">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                {state.isPaused ? "Paused" : "Processing"}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {state.tasks.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-mono rounded-2xl text-mono-secondary text-[10px] font-bold uppercase tracking-widest opacity-40">
                Queue Empty
              </div>
            ) : (
              state.tasks.map((task, index) => (
                <div
                  key={task.id}
                  className={`group relative border rounded-lg p-4 py-2 bg-mono-sidebar transition-all duration-300 ${
                    index === selectedIndex && isListActive
                      ? "ring-1 ring-white border-transparent shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                      : "border-mono"
                  } ${
                    task.status === "running"
                      ? "bg-white text-black"
                      : "hover:border-neutral-500"
                  }`}
                >
                  <div className="flex gap-4">
                    <div className="mt-1">{getStatusIcon(task.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-medium leading-relaxed break-words ${task.status === "running" ? "text-black" : "text-mono-primary"}`}
                      >
                        {task.prompt}
                      </p>
                      {task.targetUrl && (
                        <div
                          className={`flex items-center gap-1.5 text-[9px] font-bold mt-2 uppercase tracking-tighter opacity-60`}
                        >
                          <Link className="w-3 h-3" />
                          <span className="truncate max-w-[140px]">
                            {task.targetUrl.split("/").pop() || "Specific Chat"}
                          </span>
                        </div>
                      )}
                      {task.error && (
                        <p className="text-[10px] text-red-500 mt-2 font-bold uppercase tracking-tighter">
                          Error: {task.error}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(task.id)}
                      className={`opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all ${task.status === "running" ? "hover:bg-black/10 text-black" : "hover:bg-white/10 text-mono-secondary hover:text-white"}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <footer className="p-5 py-2 border-t border-mono bg-mono-sidebar/90 backdrop-blur-xl shrink-0 z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        {!state.isRunning ? (
          <button
            onClick={handleStart}
            disabled={
              state.tasks.filter((t) => t.status === "pending").length === 0
            }
            className="w-full bg-white hover:bg-neutral-200 disabled:opacity-20 py-3 rounded-lg flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-black transition-all transform active:scale-[0.98] shadow-xl shadow-black/80"
            title="Start (S)"
          >
            <Play className="w-4 h-4 fill-current" />
            Launch Worker
          </button>
        ) : (
          <div className="flex gap-3">
            {state.isPaused ? (
              <button
                onClick={handleResume}
                className="flex-1 bg-white hover:bg-neutral-200 text-black py-3 rounded-lg flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] transition-all transform active:scale-[0.98]"
                title="Resume (S)"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex-1 bg-mono-sidebar border border-mono hover:border-white text-white py-3 rounded-lg flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] transition-all transform active:scale-[0.98]"
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
