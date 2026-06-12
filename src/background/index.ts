import { QueueManager } from "./queueManager";
import { Worker } from "./worker";
import {
  isProjectLocked,
  validateChatUrl,
  getPlatformFromUrl,
  type MessageType,
  type AIPlatform,
} from "../utils/messaging";

const queueManager = new QueueManager();
const worker = new Worker(queueManager);

// Tracks whether the side panel is currently open, so the page-level "a"
// hotkey in the content script only acts when the panel is visible.
// The panel opens a long-lived Port named "panel"; when the panel closes
// (or its document is destroyed) the port disconnects, which is the most
// reliable open/close signal available in MV3.
let panelPorts = 0;
const panelOpen = () => panelPorts > 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  panelPorts++;
  port.onDisconnect.addListener(() => {
    panelPorts = Math.max(0, panelPorts - 1);
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  await queueManager.init();
  // Enable side panel on click
  (chrome as any).sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: any) => console.error(error));
});

// Kick off initialization on startup. init() is idempotent and cached, so
// this just warms the state; handlers below still `await queueManager.ready()`
// to guarantee state is loaded even if the worker was just revived.
queueManager.init();

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    console.log("[Background] Received message:", message);
    handleMessage(message)
      .then((res) => {
        console.log("[Background] Response sent:", res);
        sendResponse(res);
      })
      .catch((err) => {
        console.error("[Background] Message error:", err);
        sendResponse({ error: err.message });
      });
    return true;
  },
);

async function handleMessage(message: MessageType) {
  // CRITICAL: ensure state is loaded from storage before any handler runs.
  // The MV3 service worker may have just been revived with empty in-memory
  // state, which is why switching projects / updating tasks "did nothing".
  await queueManager.ready();
  switch (message.type) {
    case "ADD_TASK":
      return await queueManager.addTask(message.payload);
    case "REMOVE_TASK":
      return await queueManager.removeTask(message.payload);
    case "CLEAR_QUEUE":
      return await queueManager.clearQueue();
    case "START_QUEUE":
      await queueManager.setRunning(true);
      worker.start();
      return { success: true };
    case "PAUSE_QUEUE":
      await queueManager.setPaused(true);
      return { success: true };
    case "RESUME_QUEUE":
      await queueManager.setPaused(false);
      worker.start();
      return { success: true };
    case "GET_QUEUE_STATE":
      return queueManager.getState();
    case "CREATE_PROJECT":
      return await queueManager.createProject(message.payload.name);
    case "SWITCH_PROJECT":
      await queueManager.switchProject(message.payload);
      return { success: true };
    case "DELETE_PROJECT":
      await queueManager.deleteProject(message.payload);
      return { success: true };
    case "UPDATE_PROJECT_NAME":
      await queueManager.updateProjectName(
        message.payload.id,
        message.payload.name,
      );
      return { success: true };
    case "CLEAR_PROJECT_LOCK": {
      const project = queueManager
        .getState()
        .projects.find((p) => p.id === message.payload);
      if (isProjectLocked(project)) {
        return {
          success: false,
          error: "Project is locked to a chat and cannot be unlocked.",
        };
      }
      await queueManager.clearProjectLock(message.payload);
      return { success: true };
    }
    case "UPDATE_PROJECT_TARGET_URL": {
      const project = queueManager
        .getState()
        .projects.find((p) => p.id === message.payload.id);
      if (!project) {
        return { success: false, error: "Project not found." };
      }
      if (isProjectLocked(project)) {
        return {
          success: false,
          error: "Project is locked. Target URL cannot be changed.",
        };
      }
      const validation = validateChatUrl(message.payload.targetUrl);
      if (validation.ok === false) {
        return { success: false, error: validation.error };
      }
      await queueManager.updateProjectTargetUrl(
        message.payload.id,
        message.payload.targetUrl.trim(),
      );
      return { success: true };
    }
    case "SET_PROJECT_PLATFORM": {
      await queueManager.setProjectPlatform(
        message.payload.id,
        message.payload.platform,
      );
      return { success: true };
    }
    case "SET_PROJECT_NOTION_URL": {
      await queueManager.setProjectNotionUrl(
        message.payload.id,
        message.payload.notionPageUrl,
      );
      return { success: true };
    }
    case "FOCUS_TAB": {
      const tabs = await chrome.tabs.query({ url: message.payload });
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id!, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return { success: true };
    }
    case "IS_PANEL_OPEN":
      return { open: panelOpen() };
    case "CAPTURE_SELECTION": {
      // Add the page selection straight to the queue. We do NOT gate on the
      // panel being open or relay through it: the queue lives in the (persisted)
      // background state, so adding here is reliable even when the service
      // worker was just revived or the panel hasn't reconnected its port yet.
      // queueManager.persist() broadcasts QUEUE_STATE_UPDATED, which the panel
      // already listens for — so an open panel updates and auto-scrolls.
      const text = (message.payload.text || "").trim();
      if (!text) return { success: false, error: "empty" };
      // Platform is determined by the ACTIVE PROJECT, not the page the
      // selection was made on. Priority:
      //   1. If the project is locked to a chat, use that chat's platform —
      //      every task in a locked project runs on the same platform.
      //   2. Otherwise the platform the user picked in the panel.
      //   3. Fall back to the page's platform only if neither is set.
      const project = queueManager.activeProject;
      const lockedPlatform = isProjectLocked(project)
        ? getPlatformFromUrl(project?.targetUrl)
        : null;
      const platform: AIPlatform =
        lockedPlatform ??
        project?.selectedPlatform ??
        message.payload.platform;
      await queueManager.addTask({ prompt: text, platform });
      // Nudge an open panel to scroll to the newly added task.
      try {
        chrome.runtime.sendMessage({ type: "SELECTION_ADDED" }, () => {
          if (chrome.runtime.lastError) {
          }
        });
      } catch {
        // No receiver; ignore.
      }
      return { success: true };
    }
    default:
      return null;
  }
}
