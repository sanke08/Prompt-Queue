import { QueueManager } from './queueManager';
import { Worker } from './worker';
import { isProjectLocked, type MessageType } from '../utils/messaging';

const queueManager = new QueueManager();
const worker = new Worker(queueManager);

chrome.runtime.onInstalled.addListener(async () => {
  await queueManager.init();
  // Enable side panel on click
  (chrome as any).sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: any) => console.error(error));
});

// Initialize on startup
queueManager.init();

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  console.log('[Background] Received message:', message);
  handleMessage(message)
    .then(res => {
      console.log('[Background] Response sent:', res);
      sendResponse(res);
    })
    .catch(err => {
      console.error('[Background] Message error:', err);
      sendResponse({ error: err.message });
    });
  return true;
});

async function handleMessage(message: MessageType) {
  switch (message.type) {
    case 'ADD_TASK':
      return await queueManager.addTask(message.payload);
    case 'REMOVE_TASK':
      return await queueManager.removeTask(message.payload);
    case 'CLEAR_QUEUE':
      return await queueManager.clearQueue();
    case 'START_QUEUE':
      await queueManager.setRunning(true);
      worker.start();
      return { success: true };
    case 'PAUSE_QUEUE':
      await queueManager.setPaused(true);
      return { success: true };
    case 'RESUME_QUEUE':
      await queueManager.setPaused(false);
      worker.start();
      return { success: true };
    case 'GET_QUEUE_STATE':
      return queueManager.getState();
    case 'CREATE_PROJECT':
      return await queueManager.createProject(message.payload.name);
    case 'SWITCH_PROJECT':
      await queueManager.switchProject(message.payload);
      return { success: true };
    case 'DELETE_PROJECT':
      await queueManager.deleteProject(message.payload);
      return { success: true };
    case 'UPDATE_PROJECT_NAME':
      await queueManager.updateProjectName(message.payload.id, message.payload.name);
      return { success: true };
    case 'CLEAR_PROJECT_LOCK': {
      const project = queueManager.getState().projects.find(p => p.id === message.payload);
      if (isProjectLocked(project)) {
        return { success: false, error: 'Project is locked to a chat and cannot be unlocked.' };
      }
      await queueManager.clearProjectLock(message.payload);
      return { success: true };
    }
    case 'UPDATE_PROJECT_TARGET_URL': {
      const project = queueManager.getState().projects.find(p => p.id === message.payload.id);
      if (isProjectLocked(project)) {
        return { success: false, error: 'Project is locked. Target URL cannot be changed.' };
      }
      await queueManager.updateProjectTargetUrl(message.payload.id, message.payload.targetUrl);
      return { success: true };
    }
    case 'FOCUS_TAB':
      const tabs = await chrome.tabs.query({ url: message.payload });
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id!, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return { success: true };
    default:
      return null;
  }
}
