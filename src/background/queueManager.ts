import type { QueueState, Task, Project, AIPlatform } from '../utils/messaging';
import { getStoredState, saveState } from '../store/queueStore';

export class QueueManager {
  private state: QueueState = {
    projects: [],
    activeProjectId: '',
  };

  async init() {
    this.state = await getStoredState();
  }

  getState() {
    return this.state;
  }

  private get activeProject(): Project {
    const project = this.state.projects.find(p => p.id === this.state.activeProjectId);
    if (!project) {
        // Fallback or create if missing (shouldn't happen with proper init)
        return this.state.projects[0];
    }
    return project;
  }

  private updateActiveProject(updates: Partial<Project>) {
    this.state.projects = this.state.projects.map(p => 
      p.id === this.state.activeProjectId ? { ...p, ...updates } : p
    );
  }

  async addTask(payload: { prompt: string; platform: AIPlatform; targetUrl?: string }) {
    const newTask: Task = {
      id: Math.random().toString(36).substring(7),
      prompt: payload.prompt,
      platform: payload.platform,
      targetUrl: payload.targetUrl,
      status: 'pending',
    };
    
    const project = this.activeProject;
    this.updateActiveProject({
        tasks: [...project.tasks, newTask]
    });

    await this.persist();
    return newTask;
  }

  async removeTask(taskId: string) {
    const project = this.activeProject;
    this.updateActiveProject({
        tasks: project.tasks.filter(t => t.id !== taskId),
        currentTaskId: project.currentTaskId === taskId ? null : project.currentTaskId
    });
    await this.persist();
  }

  async clearQueue() {
    this.updateActiveProject({
        tasks: [],
        currentTaskId: null,
        isRunning: false
    });
    await this.persist();
  }

  async setRunning(running: boolean) {
    this.updateActiveProject({
        isRunning: running,
        isPaused: running ? this.activeProject.isPaused : false
    });
    await this.persist();
  }

  async setPaused(paused: boolean) {
    this.updateActiveProject({ isPaused: paused });
    await this.persist();
  }

  async updateTask(taskId: string, updates: Partial<Task>) {
    const project = this.activeProject;
    this.updateActiveProject({
        tasks: project.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t)
    });
    await this.persist();
  }

  async getNextPendingTask() {
    return this.activeProject.tasks.find(t => t.status === 'pending');
  }

  // --- Project Management ---

  async createProject(name: string) {
    const newProject: Project = {
        id: Math.random().toString(36).substring(7),
        name,
        tasks: [],
        isPaused: false,
        isRunning: false,
        currentTaskId: null,
        createdAt: Date.now(),
    };
    this.state.projects.push(newProject);
    this.state.activeProjectId = newProject.id;
    await this.persist();
    return newProject;
  }

  async switchProject(projectId: string) {
    if (this.state.projects.find(p => p.id === projectId)) {
        this.state.activeProjectId = projectId;
        await this.persist();
    }
  }

  async deleteProject(projectId: string) {
    // Prevent deleting the last project
    if (this.state.projects.length <= 1) return;

    this.state.projects = this.state.projects.filter(p => p.id !== projectId);
    if (this.state.activeProjectId === projectId) {
        this.state.activeProjectId = this.state.projects[0].id;
    }
    await this.persist();
  }

  async updateProjectName(projectId: string, name: string) {
    this.state.projects = this.state.projects.map(p => 
        p.id === projectId ? { ...p, name } : p
    );
    await this.persist();
  }

  private async persist() {
    await saveState(this.state);
    chrome.runtime.sendMessage({ type: 'QUEUE_STATE_UPDATED', payload: this.state }, () => {
      if (chrome.runtime.lastError) {
        // Expected if popup is closed
      }
    });
  }
}
