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
  Globe,
  Link2,
  Folder,
  ChevronDown,
  ExternalLink,
  Activity,
} from "lucide-react";
import type { QueueState, Task, AIPlatform } from "../utils/messaging";
import { sendMessageToBackground } from "../utils/messaging";

// Memoized Task Item Component for performance
const TaskItem = React.memo(
  ({
    task,
    index,
    selectedIndex,
    isListActive,
    onRemove,
    getStatusIcon,
    getPlatformBadge,
  }: {
    task: Task;
    index: number;
    selectedIndex: number;
    isListActive: boolean;
    onRemove: (id: string) => void;
    getStatusIcon: (status: Task["status"]) => React.ReactNode;
    getPlatformBadge: (platform: AIPlatform) => React.ReactNode;
  }) => {
    const isSelected = index === selectedIndex && isListActive;
    const isRunning = task.status === "running";

    return (
      <div
        className={`group relative border rounded-lg p-4 py-2 bg-mono-sidebar transition-all duration-300 ${
          isSelected
            ? "ring-1 ring-white border-transparent shadow-[0_0_20px_rgba(255,255,255,0.05)]"
            : "border-mono"
        } ${
          isRunning
            ? "bg-white text-black translate-x-1"
            : "hover:border-neutral-500"
        }`}
      >
        <div className="flex gap-4">
          <div className="mt-1 transition-transform duration-500">
            {isRunning ? (
              <div className="relative">
                <Loader2 className="w-4 h-4 text-mono-primary animate-spin" />
                <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
              </div>
            ) : (
              getStatusIcon(task.status)
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {getPlatformBadge(task.platform)}
              {isRunning && (
                <span className={`text-[8px] font-black uppercase tracking-widest animate-pulse ${isRunning ? 'text-black' : 'text-mono-primary'}`}>
                  Active
                </span>
              )}
            </div>
            <p
              className={`text-xs font-medium leading-relaxed break-words transition-colors ${isRunning ? 'text-black' : 'text-mono-primary'}`}
            >
              {task.prompt}
            </p>
            {task.statusDetail && (
              <p
                className={`text-[9px] mt-1 font-bold uppercase tracking-tighter opacity-60 flex items-center gap-1 ${isRunning ? 'text-black/60' : 'text-mono-secondary'}`}
              >
                <Activity className="w-2.5 h-2.5" />
                {task.statusDetail}
              </p>
            )}
            {task.error && (
              <p className="text-[10px] text-red-500 mt-2 font-bold uppercase tracking-tighter">
                Error: {task.error}
              </p>
            )}
          </div>
          <button
            onClick={() => onRemove(task.id)}
            className={`p-2 rounded-lg transition-all ${
              isRunning
                ? "hover:bg-black/5"
                : "hover:bg-mono-hover text-mono-secondary hover:text-red-500 opacity-0 group-hover:opacity-100"
            }`}
            title="Remove Task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  },
);

const getPlatformFromUrl = (url: string): AIPlatform | null => {
  if (!url) return null;
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com"))
    return "chatgpt";
  if (url.includes("gemini.google.com")) return "gemini";
  if (url.includes("claude.ai")) return "claude";
  return null;
};

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

const getPlatformBadge = (platform: AIPlatform) => {
  switch (platform) {
    case "chatgpt":
      return (
        <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-black uppercase tracking-tighter">
          ChatGPT
        </span>
      );
    case "gemini":
      return (
        <span className="text-[8px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 font-black uppercase tracking-tighter">
          Gemini
        </span>
      );
    case "claude":
      return (
        <span className="text-[8px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded border border-orange-500/20 font-black uppercase tracking-tighter">
          Claude
        </span>
      );
  }
};

const PLATFORM_DEFAULTS: Record<AIPlatform, string> = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai/new",
};

const App: React.FC = () => {
  const [state, setState] = useState<QueueState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedPlatform, setSelectedPlatform] =
    useState<AIPlatform>("chatgpt");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isListActive, setIsListActive] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [currentTab, setCurrentTab] = useState<{
    id: number;
    url: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProject = React.useMemo(
    () =>
      state?.projects?.find((p) => p.id === state?.activeProjectId) ||
      state?.projects?.[0],
    [state?.projects, state?.activeProjectId],
  );

  const activeTasks = React.useMemo(
    () => state?.tasks?.filter((t) => t.projectId === activeProject?.id) || [],
    [state?.tasks, activeProject?.id],
  );

  const otherRunningProjects = React.useMemo(
    () =>
      state?.projects?.filter(
        (p) => p.id !== activeProject?.id && p.isRunning && !p.isPaused,
      ) || [],
    [state?.projects, activeProject?.id],
  );

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
        (tab.url.includes("chatgpt.com") ||
          tab.url.includes("chat.openai.com") ||
          tab.url.includes("gemini.google.com") ||
          tab.url.includes("claude.ai"))
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

      if (!isInputFocused && !showShortcuts) {
        switch (e.key.toLowerCase()) {
          case "s":
            e.preventDefault();
            if (!activeProject?.isRunning) {
              if (activeTasks.some((t) => t.status === "pending"))
                handleStart();
            } else if (activeProject?.isPaused) {
              handleResume();
            } else {
              handlePause();
            }
            break;
          case "c":
            e.preventDefault();
            handleClear();
            break;
          case "i":
            e.preventDefault();
            setIsListActive(false);
            textareaRef.current?.focus();
            break;
          case "j":
          case "arrowdown":
            e.preventDefault();
            setIsListActive(true);
            setSelectedIndex((prev) =>
              Math.min(activeTasks.length - 1, prev + 1),
            );
            break;
          case "k":
          case "arrowup":
            e.preventDefault();
            setIsListActive(true);
            setSelectedIndex((prev) => Math.max(0, prev - 1));
            break;
          case "delete":
            e.preventDefault();
            if (activeTasks[selectedIndex]) {
              handleRemove(activeTasks[selectedIndex].id);
            }
            break;
          case "?":
            e.preventDefault();
            setShowShortcuts(true);
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    state,
    activeProject,
    activeTasks,
    showShortcuts,
    selectedIndex,
    isListActive,
    currentTab,
  ]);

  // Sync platform when URL changes
  useEffect(() => {
    const targetUrl = activeProject?.targetUrl || currentTab?.url || "";
    const detected = getPlatformFromUrl(targetUrl);
    if (detected) {
      setSelectedPlatform(detected);
    }
  }, [activeProject?.targetUrl, currentTab]);

  const handleAddPrompt = React.useCallback(async () => {
    if (!prompt.trim()) return;

    await sendMessageToBackground({
      type: "ADD_TASK",
      payload: {
        prompt,
        platform: selectedPlatform,
      },
    });

    setPrompt("");
  }, [prompt, selectedPlatform, activeProject?.id]);

  const handleCreateProject = React.useCallback(async () => {
    if (!newProjectName.trim()) return;
    await sendMessageToBackground({
      type: "CREATE_PROJECT",
      payload: { name: newProjectName },
    });
    setNewProjectName("");
    setIsCreatingProject(false);
  }, [newProjectName]);

  const handleSwitchProject = React.useCallback(async (id: string) => {
    await sendMessageToBackground({ type: "SWITCH_PROJECT", payload: id });
    setIsProjectMenuOpen(false);
    setSelectedIndex(0);
  }, []);

  const handleDeleteProject = React.useCallback(
    async (id: string) => {
      if (state && state.projects.length <= 1) return;
      await sendMessageToBackground({ type: "DELETE_PROJECT", payload: id });
    },
    [state?.projects.length],
  );

  const handleStart = React.useCallback(
    () => sendMessageToBackground({ type: "START_QUEUE" }),
    [],
  );
  const handlePause = React.useCallback(
    () => sendMessageToBackground({ type: "PAUSE_QUEUE" }),
    [],
  );
  const handleResume = React.useCallback(
    () => sendMessageToBackground({ type: "RESUME_QUEUE" }),
    [],
  );
  const handleClear = React.useCallback(
    () => sendMessageToBackground({ type: "CLEAR_QUEUE" }),
    [],
  );
  const handleRemove = React.useCallback(
    (id: string) =>
      sendMessageToBackground({ type: "REMOVE_TASK", payload: id }),
    [],
  );

  const handleJumpToChat = React.useCallback(() => {
    if (activeProject?.targetUrl) {
      sendMessageToBackground({
        type: "FOCUS_TAB",
        payload: activeProject.targetUrl,
      });
    }
  }, [activeProject?.targetUrl]);

  if (!state) return <div className="p-4 text-center">Loading...</div>;

  return (
    <div className="flex flex-col h-screen bg-mono-main overflow-hidden text-mono-primary selection:bg-white selection:text-black">
      {/* Header */}
      <header className="p-5 py-2 border-b border-mono bg-mono-sidebar flex justify-between items-center z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-mono-main border border-mono rounded-lg hover:border-white transition-all group"
            >
              <Folder className="w-3.5 h-3.5 text-mono-secondary group-hover:text-white" />
              <span className="text-[10px] font-black uppercase tracking-tight max-w-[100px] truncate">
                {activeProject?.name || "Project"}
              </span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isProjectMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {activeProject?.targetUrl && (
              <div className="flex gap-1 ml-1">
                <button
                  onClick={handleJumpToChat}
                  className="w-5 h-5 bg-mono-main border border-mono rounded-md flex items-center justify-center hover:bg-white hover:text-black transition-all shadow-sm"
                  title="Jump to Sticky Chat"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={() =>
                    sendMessageToBackground({
                      type: "CLEAR_PROJECT_LOCK",
                      payload: activeProject.id,
                    })
                  }
                  className="w-5 h-5 bg-mono-main border border-mono rounded-md flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-sm group/clear"
                  title="Clear Project Lock"
                >
                  <Link2 className="w-2.5 h-2.5 opacity-40 group-hover/clear:opacity-100" />
                </button>
              </div>
            )}

            {isProjectMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsProjectMenuOpen(false)}
                />
                <div className="absolute top-full left-0 mt-2 w-56 bg-mono-sidebar border border-mono rounded-xl shadow-2xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-2 border-b border-mono bg-mono-main/50">
                    <p className="text-[8px] font-black uppercase tracking-[0.2em] text-mono-secondary px-2 py-1">
                      Projects
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto custom-scroll">
                    {state?.projects?.map((p) => (
                      <div
                        key={p.id}
                        className="group/item flex items-center justify-between p-1 px-2 hover:bg-mono-hover"
                      >
                        <button
                          onClick={() => handleSwitchProject(p.id)}
                          className="flex-1 flex items-center gap-2 p-2 text-left"
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${p.id === activeProject?.id ? "bg-white shadow-[0_0_8px_white]" : "bg-transparent border border-mono"}`}
                          />
                          <span
                            className={`text-[10px] font-bold ${p.id === activeProject?.id ? "text-white" : "text-mono-secondary"}`}
                          >
                            {p.name}
                          </span>
                          {p.targetUrl && (
                            <Link2 className="w-2.5 h-2.5 text-mono-secondary" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteProject(p.id)}
                          className="p-2 opacity-0 group-hover/item:opacity-40 hover:!opacity-100 transition-opacity text-red-500"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="p-2 border-t border-mono">
                    {isCreatingProject ? (
                      <div className="flex items-center gap-1 p-1">
                        <input
                          autoFocus
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleCreateProject()
                          }
                          placeholder="Project name..."
                          className="flex-1 bg-mono-main border border-mono rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-white"
                        />
                        <button
                          onClick={handleCreateProject}
                          className="p-1.5 bg-white text-black rounded hover:bg-neutral-200"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsCreatingProject(true)}
                        className="w-full flex items-center gap-2 p-2 text-[10px] font-black uppercase tracking-tighter text-mono-secondary hover:text-white transition-colors"
                      >
                        <Plus className="w-3 h-3" /> New Project
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-1.5 hover:bg-mono-hover rounded-lg text-mono-secondary transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col p-10 animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-black shadow-lg">
                <Command className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-black uppercase tracking-tighter">
                Shortcuts
              </h2>
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
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
            ].map((shortcut, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-3 border-b border-white/5 last:border-0"
              >
                <div className="flex gap-1.5">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="px-2 py-1 bg-white text-black text-[9px] font-black rounded uppercase min-w-[24px] text-center shadow-[0_2px_0_#ccc]"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
                <span className="text-[10px] font-bold text-mono-secondary uppercase tracking-tight">
                  {shortcut.desc}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center text-[9px] text-mono-secondary font-black uppercase tracking-[0.3em] opacity-40">
            Esc to close
          </div>
        </div>
      )}

      {/* Global Activity Bar */}
      {otherRunningProjects.length > 0 && (
        <div className="bg-mono-sidebar border-b border-mono p-1 px-4 flex items-center gap-4 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Activity className="w-3 h-3 text-white" />
              <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
            </div>
            <span className="text-[8px] font-black uppercase tracking-widest">
              Global Activity
            </span>
          </div>
          <div className="flex gap-2 animate-in fade-in slide-in-from-left duration-1000">
            {otherRunningProjects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 bg-mono-main border border-mono rounded-full px-2 py-0.5 max-w-[120px]"
              >
                <div className="w-1 h-1 bg-white rounded-full animate-pulse" />
                <span className="text-[8px] font-bold truncate opacity-60">
                  {p.name}
                </span>
              </div>
            ))}
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
            {activeProject && (
              <button
                onClick={() => {
                  if (activeProject.targetUrl) {
                    sendMessageToBackground({
                      type: "CLEAR_PROJECT_LOCK",
                      payload: activeProject.id,
                    });
                  } else {
                    const currentPlatform = getPlatformFromUrl(
                      currentTab?.url || "",
                    );
                    const targetUrl =
                      currentPlatform === selectedPlatform
                        ? currentTab?.url || PLATFORM_DEFAULTS[selectedPlatform]
                        : PLATFORM_DEFAULTS[selectedPlatform];

                    sendMessageToBackground({
                      type: "UPDATE_PROJECT_TARGET_URL",
                      payload: {
                        id: activeProject.id,
                        targetUrl: targetUrl,
                      },
                    });
                  }
                }}
                className={`flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all uppercase tracking-tighter ${
                  activeProject?.targetUrl
                    ? "bg-white text-black"
                    : "bg-mono-sidebar text-mono-secondary border border-mono hover:border-white"
                }`}
              >
                {activeProject?.targetUrl ? (
                  <Link2 className="w-3 h-3" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                {activeProject?.targetUrl ? "Locked" : "Lock Chat"}
              </button>
            )}
          </div>

          {/* Platform Selector */}
          <div className="flex gap-2">
            {(["chatgpt", "gemini", "claude"] as AIPlatform[]).map((p) => {
              const isDisabled = !!activeProject?.targetUrl;
              return (
                <button
                  key={p}
                  disabled={isDisabled}
                  onClick={() => setSelectedPlatform(p)}
                  className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                    selectedPlatform === p
                      ? "bg-white text-black shadow-md"
                      : "bg-mono-sidebar text-mono-secondary"
                  } ${isDisabled ? "opacity-50 cursor-not-allowed" : "hover:border-neutral-500 border border-transparent"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {activeProject?.targetUrl && (
            <div className="flex items-center gap-2 px-3 py-1 bg-mono-sidebar border border-mono rounded-lg animate-in slide-in-from-top-2 duration-300">
              <Link2 className="w-2.5 h-2.5 text-mono-secondary shrink-0" />
              <input
                type="text"
                value={activeProject.targetUrl || ""}
                onChange={(e) =>
                  sendMessageToBackground({
                    type: "UPDATE_PROJECT_TARGET_URL",
                    payload: {
                      id: activeProject.id,
                      targetUrl: e.target.value,
                    },
                  })
                }
                placeholder="Paste specific chat URL here..."
                className="flex-1 bg-transparent border-none text-[8px] font-bold text-mono-primary focus:outline-none focus:ring-0 placeholder:text-neutral-700 tracking-tight"
              />
              <button
                onClick={() =>
                  sendMessageToBackground({
                    type: "CLEAR_PROJECT_LOCK",
                    payload: activeProject.id,
                  })
                }
                className="text-[8px] font-black uppercase text-red-500/60 hover:text-red-500 transition-colors"
              >
                Unlock
              </button>
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
            <Plus className="w-4 h-4" />
            Add to Queue
          </button>
        </div>

        {/* Scrollable Queue List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scroll">
          <div className="flex justify-between items-center text-[10px] text-mono-secondary font-black uppercase tracking-[0.2em] px-1 mb-2">
            <span>
              {activeProject?.name || "Queue"} ({activeTasks.length || 0})
            </span>
            {activeProject?.isRunning && (
              <span className="flex items-center gap-2 text-white">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                {activeProject?.isPaused ? "Paused" : "Processing"}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {activeTasks.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-mono rounded-2xl text-mono-secondary text-[10px] font-bold uppercase tracking-widest opacity-40">
                Queue Empty
              </div>
            ) : (
              activeTasks.map((task, index) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  index={index}
                  selectedIndex={selectedIndex}
                  isListActive={isListActive}
                  onRemove={handleRemove}
                  getStatusIcon={getStatusIcon}
                  getPlatformBadge={getPlatformBadge}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <footer className="p-5 py-2 border-t border-mono bg-mono-sidebar/90 backdrop-blur-xl shrink-0 z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        {!activeProject?.isRunning ? (
          <button
            onClick={handleStart}
            disabled={
              !activeProject ||
              activeTasks.filter((t) => t.status === "pending").length === 0
            }
            className="w-full bg-white hover:bg-neutral-200 disabled:opacity-20 py-3 rounded-lg flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-black transition-all transform active:scale-[0.98] shadow-xl shadow-black/80"
            title="Start (S)"
          >
            <Play className="w-4 h-4 fill-current" />
            Launch Worker
          </button>
        ) : (
          <div className="flex gap-3">
            {activeProject?.isPaused ? (
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
