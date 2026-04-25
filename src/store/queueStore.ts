import type { QueueState, Task } from '../utils/messaging';

const STORAGE_KEY = 'chatgpt_queue_state';

const DEFAULT_STATE: QueueState = {
  tasks: [],
  isPaused: false,
  isRunning: false,
  currentTaskId: null,
};

export const getStoredState = async (): Promise<QueueState> => {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result: { [key: string]: any }) => {
      resolve(result[STORAGE_KEY] || DEFAULT_STATE);
    });
  });
};

export const saveState = async (state: QueueState): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
      resolve();
    });
  });
};

export const updateTaskStatus = async (taskId: string, status: Task['status'], error?: string): Promise<QueueState> => {
  const state = await getStoredState();
  const updatedTasks = state.tasks.map(t => 
    t.id === taskId ? { ...t, status, error } : t
  );
  const newState = { ...state, tasks: updatedTasks };
  await saveState(newState);
  return newState;
};
