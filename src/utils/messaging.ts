export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export type AIPlatform = 'chatgpt' | 'gemini' | 'claude';

export interface Task {
  id: string;
  projectId: string;
  prompt: string;
  status: TaskStatus;
  platform: AIPlatform;
  error?: string;
  response?: string;
  statusDetail?: string;
  completedAt?: number;
}

export interface Project {
  id: string;
  name: string;
  isPaused: boolean;
  isRunning: boolean;
  currentTaskId: string | null;
  createdAt: number;
  targetUrl?: string;
}

export interface QueueState {
  projects: Project[];
  tasks: Task[];
  activeProjectId: string;
}

export function isNewChatUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname.replace(/\/+$/, "") || "/";

    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      return path === "/" || path === "";
    }
    if (host.includes("gemini.google.com")) {
      return path === "/app" || path.endsWith("/app") || path === "/u/0/app" || path === "/";
    }
    if (host.includes("claude.ai")) {
      return path === "/new" || path === "/chat" || path === "/" || path === "";
    }
    return false;
  } catch {
    return true;
  }
}

export function isProjectLocked(project: Pick<Project, "targetUrl"> | null | undefined): boolean {
  if (!project || !project.targetUrl) return false;
  return !isNewChatUrl(project.targetUrl);
}

export function getPlatformFromUrl(url: string | undefined | null): AIPlatform | null {
  if (!url) return null;
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
  if (url.includes("gemini.google.com")) return "gemini";
  if (url.includes("claude.ai")) return "claude";
  return null;
}

export type MessageType = 
  | { type: 'ADD_TASK'; payload: { prompt: string; platform: AIPlatform } }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'START_QUEUE' }
  | { type: 'PAUSE_QUEUE' }
  | { type: 'RESUME_QUEUE' }
  | { type: 'GET_QUEUE_STATE' }
  | { type: 'QUEUE_STATE_UPDATED'; payload: QueueState }
  | { type: 'EXECUTE_PROMPT'; payload: string }
  | { type: 'PROMPT_COMPLETED'; payload: { success: boolean; error?: string; response?: string } }
  | { type: 'PING' }
  | { type: 'CREATE_PROJECT'; payload: { name: string } }
  | { type: 'SWITCH_PROJECT'; payload: string }
  | { type: 'DELETE_PROJECT'; payload: string }
  | { type: 'UPDATE_PROJECT_NAME'; payload: { id: string; name: string } }
  | { type: 'CLEAR_PROJECT_LOCK'; payload: string }
  | { type: 'UPDATE_PROJECT_TARGET_URL'; payload: { id: string; targetUrl: string } }
  | { type: 'FOCUS_TAB'; payload: string };

export const sendMessageToBackground = async (message: MessageType, retries = 3): Promise<any> => {
  console.log('[Messaging] Sending to Background:', message);
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn(`[Messaging] Background attempt ${i + 1} failed:`, chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          console.log('[Messaging] Background response:', response);
          resolve(response);
        });
      });
    } catch (err) {
      if (i === retries - 1) {
        console.error('[Messaging] Background all retries failed:', err);
        throw err;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
};

export const sendMessageToTab = async (tabId: number, message: MessageType, retries = 5): Promise<any> => {
  console.log(`[Messaging] Sending to Tab ${tabId}:`, message);
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response: any) => {
          if (chrome.runtime.lastError) {
            console.warn(`[Messaging] Tab ${tabId} attempt ${i + 1} failed:`, chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          console.log(`[Messaging] Tab ${tabId} response:`, response);
          resolve(response);
        });
      });
    } catch (err) {
      if (i === retries - 1) {
        console.error(`[Messaging] Tab ${tabId} all retries failed:`, err);
        throw err;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};
