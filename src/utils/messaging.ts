export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export type AIPlatform = 'chatgpt' | 'gemini' | 'claude';

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  platform: AIPlatform;
  targetUrl?: string;
  error?: string;
  response?: string;
  completedAt?: number;
}

export interface Project {
  id: string;
  name: string;
  tasks: Task[];
  isPaused: boolean;
  isRunning: boolean;
  currentTaskId: string | null;
  createdAt: number;
  targetUrl?: string;
}

export interface QueueState {
  projects: Project[];
  activeProjectId: string;
}

export type MessageType = 
  | { type: 'ADD_TASK'; payload: { prompt: string; platform: AIPlatform; targetUrl?: string } }
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
  | { type: 'CLEAR_PROJECT_LOCK'; payload: string };

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
