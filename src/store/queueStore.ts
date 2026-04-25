import type { QueueState, Project } from '../utils/messaging';

const STORAGE_KEY = 'prompt_queue_state';

const createDefaultProject = (): Project => ({
  id: 'default',
  name: 'Default Project',
  tasks: [],
  isPaused: false,
  isRunning: false,
  currentTaskId: null,
  createdAt: Date.now(),
});

const DEFAULT_STATE: QueueState = {
  projects: [createDefaultProject()],
  activeProjectId: 'default',
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
