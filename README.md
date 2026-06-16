# Prompt Queue

A Chrome extension (Manifest V3) that queues and automates prompts across ChatGPT, Google Gemini, and Claude AI from a persistent side panel.

You build a queue of prompts, hit Start, and the extension works through each one automatically — navigating to the AI platform, injecting the prompt, waiting for the response, then advancing to the next task.

---

## Table of Contents

- [Supported Platforms](#supported-platforms)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Data Model](#data-model)
- [Content Script Selectors](#content-script-selectors)
- [Message Types Reference](#message-types-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Build and Install](#build-and-install)
- [Project Structure](#project-structure)

---

## Supported Platforms

| Platform | Matched URLs |
|---|---|
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Google Gemini | `gemini.google.com` |
| Claude | `claude.ai` |

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Build Tool | Vite | 5.4.21 |
| UI Framework | React | 19.2.5 |
| Language | TypeScript | ~6.0.2 |
| Styling | Tailwind CSS | 3.4.19 |
| Extension Type | Chrome MV3 | — |
| Package Manager | pnpm | — |

No environment variables are required.

---

## Architecture Overview

The extension has four distinct parts that communicate via Chrome's messaging API.

```
+================================================================+
|                        CHROME BROWSER                          |
|                                                                |
|  +----------------------+        +---------------------------+ |
|  |  SIDE PANEL          |        |  BACKGROUND SERVICE       | |
|  |  (React UI)          | <----> |  WORKER                   | |
|  |                      |        |                           | |
|  |  src/popup/App.tsx   |        |  queueManager.ts          | |
|  |  1086 lines          |        |  (state, CRUD, storage)   | |
|  |                      |        |                           | |
|  |  - Project switching |        |  worker.ts                | |
|  |  - Task queue list   |        |  (execution loop, tabs)   | |
|  |  - Platform selector |        +---------------------------+ |
|  |  - Notion URL bind   |                  ^                   |
|  |  - Keyboard nav      |                  | messages          |
|  +----------------------+                  v                   |
|                                 +---------------------------+  |
|  +---------------------------+  |  CONTENT SCRIPTS          |  |
|  |  AI PLATFORM TAB          |  |  (injected into AI tabs)  |  |
|  |  chatgpt.com /            |  |                           |  |
|  |  gemini.google.com /      |  |  src/content/ (flat dir): |  |
|  |  claude.ai                |  |  adapter.ts               |  |
|  |                           |  |  chatgptAdapter.ts        |  |
|  |  content script injected  |  |  geminiAdapter.ts         |  |
|  +---------------------------+  |  claudeAdapter.ts         |  |
|                                 |  observer.ts              |  |
|  +---------------------------+  +---------------------------+  |
|  |  NOTION TAB (optional)    |                                 |
|  |  notion.so page           |  src/notion/index.ts            |
|  |  receives pasted images   |  (5-tier block matching,        |
|  +---------------------------+   clipboard paste)              |
+================================================================+
```

### Background Service Worker

**`queueManager.ts`** — single source of truth for all state. Handles project and task CRUD, persists everything to `chrome.storage.local`, and broadcasts `QUEUE_STATE_UPDATED` to the side panel after every mutation.

**`worker.ts`** — task execution engine. Runs the automation loop per platform with three tab-finding strategies, sends `EXECUTE_PROMPT` to content scripts, retries up to 5 times with a 3-second delay, and optionally triggers Notion image capture on completion.

**Tab management strategies (in order):**
1. Find an existing tab at the project's bound `targetUrl`
2. Find any open new-chat tab for the platform (URL with no chat ID)
3. Create a new tab at the platform base URL

### Content Scripts

All adapter files live directly in `src/content/` as flat files — there is no `adapters/` subdirectory. Each adapter implements four functions: `findInput()`, `setInputValue()`, `send()`, `isGenerating()`.

`observer.ts` provides `MutationObserver` utilities shared across adapters for detecting when the AI starts or finishes generating.

### Popup / Side Panel

`src/popup/App.tsx` (1086 lines) renders in Chrome's native side panel via the `sidePanel` API. It is stateless — it re-renders on every `QUEUE_STATE_UPDATED` message from the background. Handles project switching, task queue display, platform selection, URL binding to a specific chat, and Notion URL binding.

### Notion Integration

`src/notion/index.ts` is a content script injected into `notion.so` pages. It receives a `NOTION_PASTE_IMAGE` message, runs 5-tier text block matching to find the prompt's location in the page, then pastes the captured AI response image above that block via the clipboard API.

---

## Data Model

### Task

```ts
type TaskStatus = 'pending' | 'running' | 'done' | 'error';

interface Task {
  id: string;
  projectId: string;
  prompt: string;
  status: TaskStatus;
  platform: 'chatgpt' | 'gemini' | 'claude';
  error?: string;
  statusDetail?: string;
  completedAt?: number;
}
```

### Project

```ts
interface Project {
  id: string;
  name: string;
  isPaused: boolean;
  isRunning: boolean;
  currentTaskId: string | null;
  createdAt: number;
  targetUrl?: string;           // specific chat URL to reuse
  selectedPlatform?: string;    // 'chatgpt' | 'gemini' | 'claude'
  notionPageUrl?: string;       // if set, pastes response images to Notion
}
```

### QueueState

```ts
interface QueueState {
  projects: Project[];
  tasks: Task[];
}
```

`tasks[].projectId` links each task to its parent project. `project.currentTaskId` points to the task currently executing.

---

## Content Script Selectors

### ChatGPT (`chatgptAdapter.ts`)

| Method | DOM target |
|---|---|
| `findInput()` | `#prompt-textarea` (contenteditable div) |
| `send()` | `button[data-testid="send-button"]` |

### Claude (`claudeAdapter.ts`)

| Method | DOM target |
|---|---|
| `findInput()` | ProseMirror `contenteditable` div |
| `send()` | `button[aria-label="Send Message"]` |

### Gemini (`geminiAdapter.ts`)

| Method | DOM target |
|---|---|
| `findInput()` | `.ql-editor` (Quill editor) |
| `send()` | `button[aria-label="Send message"]` |

---

## Message Types Reference

All communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with typed message objects.

### Queue Management (Side Panel → Background)

| Message | Description |
|---|---|
| `ADD_TASK` | Add a new task to a project's queue |
| `REMOVE_TASK` | Delete a task by ID |
| `CLEAR_QUEUE` | Remove all tasks from a project |
| `START_QUEUE` | Begin executing the task queue |
| `PAUSE_QUEUE` | Pause execution after the current task finishes |
| `RESUME_QUEUE` | Resume from paused state |
| `GET_QUEUE_STATE` | Request a full state snapshot |

### State Sync (Background → Side Panel)

| Message | Description |
|---|---|
| `QUEUE_STATE_UPDATED` | Push updated `QueueState` to the side panel |

### Execution (Background → Content Script)

| Message | Description |
|---|---|
| `EXECUTE_PROMPT` | Inject prompt text and submit it |
| `PING` | Check if the content script is alive in the tab |

### Capture and Notion

| Message | Direction | Description |
|---|---|---|
| `CAPTURE_IMAGE` | Background → Content | Screenshot the AI response area |
| `CAPTURE_SELECTION` | Content → Background | User selected text on AI page; add to queue |
| `NOTION_PASTE_IMAGE` | Background → Notion Script | Paste captured image into Notion page |

### Project Operations (Side Panel → Background)

| Message | Description |
|---|---|
| `CREATE_PROJECT` | Create a new project |
| `UPDATE_PROJECT` | Update project settings |
| `DELETE_PROJECT` | Remove a project and all its tasks |
| `SET_ACTIVE_PROJECT` | Switch the active project in the panel |

---

## Keyboard Shortcuts

All shortcuts are active when the side panel is focused. The `A` shortcut is active on AI platform tabs.

| Key | Action |
|---|---|
| `S` | Start / Pause / Resume queue (toggles based on state) |
| `C` | Clear queue (removes all pending tasks) |
| `I` | Focus the prompt input textarea |
| `J` or `ArrowDown` | Navigate task list downward |
| `K` or `ArrowUp` | Navigate task list upward |
| `Delete` | Remove the currently selected task |
| `?` | Toggle keyboard shortcuts help overlay |
| `Enter` | Submit textarea as a new task |
| `Shift+Enter` | Insert a new line in the prompt input |
| `A` | Capture page selection to queue (on AI platform tabs) |

---

## Build and Install

### Prerequisites

- Node.js
- pnpm

### Build

```bash
pnpm install
pnpm build
```

The build outputs four entry points to `dist/`:

| File | Entry point |
|---|---|
| `index.html` | Side panel React UI |
| `background.js` | Service worker |
| `content.js` | Unified content script (all platform adapters) |
| `notion.js` | Notion integration script |

### Install in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `dist/` directory
5. The extension icon appears in the toolbar
6. Click the icon and select **Open Side Panel**

### Development Watch Mode

```bash
pnpm dev
```

Vite watches for changes and rebuilds automatically. After each rebuild, go to `chrome://extensions` and click the reload icon on the extension card.

---

## Project Structure

```
Prompt-Queue/
├── src/
│   ├── background/
│   │   ├── index.ts            # Service worker entry point
│   │   ├── queueManager.ts     # State management, chrome.storage.local persistence
│   │   └── worker.ts           # Task execution loop, tab management, retry logic
│   │
│   ├── content/                # Flat directory — no adapters/ subdirectory
│   │   ├── adapter.ts          # Platform dispatch and unified message handler
│   │   ├── observer.ts         # MutationObserver utilities (generation detection)
│   │   ├── chatgptAdapter.ts   # ChatGPT DOM adapter
│   │   ├── geminiAdapter.ts    # Gemini DOM adapter
│   │   └── claudeAdapter.ts    # Claude DOM adapter
│   │
│   ├── popup/
│   │   └── App.tsx             # Side panel root component (1086 lines)
│   │
│   ├── notion/
│   │   └── index.ts            # Notion content script (block matching, clipboard paste)
│   │
│   └── store/                  # Shared state helpers
│       └── utils/
│
├── public/
│   ├── manifest.json           # Chrome MV3 manifest
│   └── icons/
│
├── index.html                  # Side panel HTML entry
├── vite.config.ts              # Multi-entry Rollup build config (4 entry points)
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

### Manifest Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persist queue state and projects across sessions |
| `tabs` | Create, find, and focus AI platform tabs |
| `activeTab` | Access the currently active tab |
| `scripting` | Dynamically inject content scripts when needed |
| `sidePanel` | Render the React UI in Chrome's side panel |
| `notifications` | Notify the user when the queue finishes or errors |

### Host Permissions

| Host | Purpose |
|---|---|
| `chatgpt.com`, `chat.openai.com` | ChatGPT content script injection |
| `gemini.google.com` | Gemini content script injection |
| `claude.ai` | Claude content script injection |
| `www.notion.so` | Notion paste integration |

---

## Architecture

```
Chrome Browser
    │
    ├──▶ Side Panel (React UI - popup/App.tsx)
    │        shows queue, project switcher, platform selector
    │        communicates via chrome.runtime.sendMessage
    │
    ├──▶ Background Service Worker
    │        queueManager.ts → state + chrome.storage.local
    │        worker.ts → execution loop per platform
    │
    ├──▶ Content Scripts (injected into AI pages)
    │        chatgptAdapter.ts → ChatGPT DOM
    │        geminiAdapter.ts  → Gemini DOM
    │        claudeAdapter.ts  → Claude DOM
    │        observer.ts       → waitForCompletion()
    │
    └──▶ Notion Script (injected into Notion pages)
             notion/index.ts → paste image above prompt block
```

---

## User Flow

1. **Install** → load dist/ in chrome://extensions → side panel opens on AI pages

2. **Add Prompts** → open side panel → type prompt in input → Enter → task added to queue with status "pending"

3. **Start Queue** → press S (or Start button) → worker starts processing:
   - finds first pending task
   - opens/navigates to ChatGPT/Gemini/Claude tab
   - PINGs content script (reloads if no response)
   - EXECUTE_PROMPT → adapter fills input + clicks send
   - observer.ts polls isGenerating() until done
   - task marked "done", next task starts

4. **Lock to Conversation** → "Bind this chat" button → targetUrl set to current tab URL → all tasks run in that specific conversation

5. **Notion Image Capture** → set notionPageUrl → after each prompt completes:
   - CAPTURE_IMAGE from AI tab
   - find Notion tab (open if needed)
   - 5-tier text matching finds the prompt block
   - paste captured image above prompt block via clipboard

6. **Multi-Project** → create project → switch projects → each has independent queue + platform

7. **Keyboard Navigation** → J/K navigate tasks, Delete removes, S pauses/resumes

---

## Data Flow

```
User adds prompt "Explain React hooks"
    │
    ▼ Side panel: sendMessage(ADD_TASK, { prompt, platform:"chatgpt" })
Background: queueManager.addTask()
    │ Task { id, prompt, status:"pending", platform:"chatgpt" }
    │ persists to chrome.storage.local
    │ broadcasts QUEUE_STATE_UPDATED to all panels
    │
Worker execution loop detects pending task
    ▼
ensureAITab("chatgpt")
    │ finds existing ChatGPT new-chat tab OR creates one
    │ waits for tab.status === "complete"
    ▼
sendMessageToTab(tabId, PING) → content script responds
    ▼
sendMessageToTab(tabId, EXECUTE_PROMPT, { prompt })
    │
    ▼ chatgptAdapter.ts (content script)
    findInput() → #prompt-textarea
    setInputValue(el, "Explain React hooks")
    send() → clicks button[data-testid="send-button"]
    ▼
observer.ts: poll isGenerating() every 500ms
    until send button re-enables → generation complete
    ▼
Task marked status:"done"
Next pending task starts
```
