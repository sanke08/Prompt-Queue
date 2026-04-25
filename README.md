# Prompt Queue 🤖🚀

A powerful, professional-grade Chrome Extension designed to automate sequential prompt execution across multiple AI platforms including **ChatGPT**, **Google Gemini**, and **Claude AI**.

## ✨ Features

- **Multi-Platform Support**: Seamlessly automate prompts for ChatGPT, Gemini, and Claude.
- **Sequential Queueing**: Add multiple prompts and let the automator handle them one by one. No more waiting for one response to finish before typing the next.
- **Project Management**: Organize your work into "Projects" (e.g., "Blog Generation", "Market Research"). Each project has its own independent queue and running state.
- **Side Panel Integration**: Persists as a sidebar, allowing you to browse or use the AI chat while the automator works in the background.
- **Smart Routing & Locking**:
  - **Any Chat**: Runs tasks in the first available tab of the target platform.
  - **Locked Mode**: Pin a task to a specific browser tab or conversation URL.
- **Platform Auto-Detection**: Automatically identifies which platform you are on and syncs your settings.
- **Premium design**: A sleek, monochrome "Studio" aesthetic with smooth animations and dark mode.
- **Vim-inspired Shortcuts**: Navigate the entire UI without touching your mouse.

---

## 🛠️ Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (recommended) or npm

### Setup Steps
1. **Clone the repository**:
   ```bash
   git clone https://github.com/sanke08/Prompt-Queue.git
   cd Prompt-Queue
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Build the extension**:
   ```bash
   pnpm build
   ```
   This will generate a `dist` folder.

4. **Load into Chrome**:
   - Open Chrome and go to `chrome://extensions/`.
   - Enable **Developer mode** (toggle in the top right).
   - Click **Load unpacked**.
   - Select the `dist` folder in the project directory.

---

## 🚀 How to Use

### 1. Open the Automator
Click the **Prompt Queue** icon in your Chrome extensions bar. It will open as a persistent **Side Panel**.

### 2. Create a Project
Click the **Project Selector** (folder icon) in the header to create a new project. Use this to keep different task sets organized.

### 3. Add Prompts
- Select your target **Platform** (ChatGPT, Gemini, or Claude).
- Type your prompt in the text area.
- (Optional) Toggle **LOCKED** to pin the prompt to the current tab/conversation.
- Press `Enter` or click **Add to Queue**.

### 4. Launch the Worker
Click the **Launch Worker** button at the bottom. The extension will:
- Find or open the correct AI tab.
- Inject the prompt.
- Wait for the response to complete.
- Automatically move to the next task.

---

## ⌨️ Keyboard Shortcuts

The UI is optimized for speed with the following shortcuts (Global when input is not focused):

| Key | Action |
|-----|--------|
| `S` | Start / Pause / Resume Worker |
| `C` | Clear the entire project queue |
| `I` | Focus the prompt input area |
| `J` / `K` | Navigate up/down the task list |
| `Delete` | Remove the selected task |
| `Alt + L` | Toggle "Lock to Current Tab" |
| `?` | Toggle the Shortcuts help overlay |
| `Esc` | Clear current input or close overlays |
| `Enter` | (In Input) Add task to queue |
| `Shift + Enter` | (In Input) Add a new line |

---

## 🏗️ Architecture

- **`Background Script`**: The brain of the extension.
  - `QueueManager`: Handles projects, task persistence, and state updates.
  - `Worker`: Coordinates with browser tabs, manages navigation, and handles retries.
- **`Content Script`**: The hands.
  - Detects the active AI platform.
  - Injects prompts directly into the DOM.
  - Monitors the UI for "generation complete" states using platform-specific adapters.
- **`Platform Adapters`**: Specialized logic for different AI UIs.
  - `ChatGPTAdapter`: Targets standard GPT chat elements.
  - `GeminiAdapter`: Targets Google's specific Quill editor and stop indicators.
  - `ClaudeAdapter`: Targets Anthropic's ProseMirror editor and streaming states.
- **`Popup (Side Panel)`**: A React-based interface built with Vite and Tailwind-style design tokens for a premium experience.

---

## 📄 License
This project is private and for internal use.

---

*Developed with ❤️ for high-productivity AI workflows.*
