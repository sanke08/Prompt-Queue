import type { QueueState, Task } from '../utils/messaging';
import { getStoredState, saveState } from '../store/queueStore';

export class QueueManager {
  private state: QueueState = {
    tasks: [],
    isPaused: false,
    isRunning: false,
    currentTaskId: null,
  };

  async init() {
    this.state = await getStoredState();
  }

  getState() {
    return this.state;
  }

  async addTask(prompt: string) {
    const newTask: Task = {
      id: Math.random().toString(36).substring(7),
      prompt,
      status: 'pending',
    };
    this.state.tasks.push(newTask);
    await this.persist();
    return newTask;
  }

  async removeTask(taskId: string) {
    this.state.tasks = this.state.tasks.filter(t => t.id !== taskId);
    if (this.state.currentTaskId === taskId) {
      this.state.currentTaskId = null;
    }
    await this.persist();
  }

  async clearQueue() {
    this.state.tasks = [];
    this.state.currentTaskId = null;
    this.state.isRunning = false;
    await this.persist();
  }

  async setRunning(running: boolean) {
    this.state.isRunning = running;
    if (!running) {
      this.state.isPaused = false;
    }
    await this.persist();
  }

  async setPaused(paused: boolean) {
    this.state.isPaused = paused;
    await this.persist();
  }

  async updateTask(taskId: string, updates: Partial<Task>) {
    this.state.tasks = this.state.tasks.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    );
    await this.persist();
  }

  async getNextPendingTask() {
    return this.state.tasks.find(t => t.status === 'pending');
  }

  private async persist() {
    await saveState(this.state);
    chrome.runtime.sendMessage({ type: 'QUEUE_STATE_UPDATED', payload: this.state }, () => {
      // Accessing lastError suppresses the "Unchecked runtime.lastError" console message
      if (chrome.runtime.lastError) {
        // Expected if popup is closed
      }
    });
  }
}
