import type { QueueState, Task, Project, AIPlatform } from '../utils/messaging';
import { getStoredState, saveState } from '../store/queueStore';

export class QueueManager {
  private state: QueueState = {
    projects: [],
    tasks: [],
    activeProjectId: '',
  };

  // In MV3 the service worker is killed when idle and restarted on the next
  // event. init() reloads state from storage, but message handlers can fire
  // before it finishes. We cache the in-flight promise so every handler can
  // `await ready()` and be guaranteed to operate on real, loaded state.
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.load();
    }
    return this.initPromise;
  }

  /** Await this at the top of every handler that touches state. */
  ready(): Promise<void> {
    return this.init();
  }

  private async load() {
    const stored = await getStoredState();
    // Migrating old state if necessary (simple check)
    if (stored && !Array.isArray(stored.tasks)) {
       this.state = {
         ...stored,
         tasks: (stored as any).projects?.flatMap((p: any) =>
           (p.tasks || []).map((t: any) => ({ ...t, projectId: p.id }))
         ) || [],
         projects: (stored as any).projects?.map((p: any) => {
           const { tasks, ...proj } = p;
           return proj;
         }) || []
       };
    } else {
       this.state = stored || this.state;
    }
  }

  getState() {
    return this.state;
  }

  private get activeProject(): Project | undefined {
    return this.state.projects.find(p => p.id === this.state.activeProjectId) || this.state.projects[0];
  }

  private updateProject(projectId: string, updates: Partial<Project>) {
    this.state.projects = this.state.projects.map(p => 
      p.id === projectId ? { ...p, ...updates } : p
    );
  }

  async addTask(payload: { prompt: string; platform: AIPlatform }) {
    const project = this.activeProject;
    if (!project) throw new Error("No active project");

    const newTask: Task = {
      id: Math.random().toString(36).substring(7),
      projectId: project.id,
      prompt: payload.prompt,
      platform: payload.platform,
      status: 'pending',
    };
    
    this.state.tasks.push(newTask);
    await this.persist();
    return newTask;
  }

  async removeTask(taskId: string) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;

    this.state.tasks = this.state.tasks.filter(t => t.id !== taskId);
    
    const project = this.state.projects.find(p => p.id === task.projectId);
    if (project && project.currentTaskId === taskId) {
        this.updateProject(project.id, { currentTaskId: null });
    }
    
    await this.persist();
  }

  async clearQueue(projectId?: string) {
    const pid = projectId || this.state.activeProjectId;
    this.state.tasks = this.state.tasks.filter(t => t.projectId !== pid);
    this.updateProject(pid, {
        currentTaskId: null,
        isRunning: false
    });
    await this.persist();
  }

  async setRunning(running: boolean, projectId?: string) {
    const pid = projectId || this.state.activeProjectId;
    const project = this.state.projects.find(p => p.id === pid);
    if (!project) return;

    this.updateProject(pid, {
        isRunning: running,
        isPaused: running ? project.isPaused : false
    });
    await this.persist();
  }

  async setPaused(paused: boolean, projectId?: string) {
    const pid = projectId || this.state.activeProjectId;
    this.updateProject(pid, { isPaused: paused });
    await this.persist();
  }

  async updateTask(taskId: string, updates: Partial<Task>) {
    this.state.tasks = this.state.tasks.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    );
    await this.persist();
  }

  async getNextPendingTask(projectId?: string) {
    const pid = projectId || this.state.activeProjectId;
    return this.state.tasks.find(t => t.projectId === pid && t.status === 'pending');
  }

  async getNextPendingTaskForPlatform(platform: AIPlatform) {
    for (const project of this.state.projects) {
        if (!project.isRunning || project.isPaused) continue;
        const task = this.state.tasks.find(t => 
            t.projectId === project.id && 
            t.status === 'pending' && 
            t.platform === platform
        );
        if (task) return { task, project };
    }
    return null;
  }

  // --- Project Management ---

  async createProject(name: string) {
    const newProject: Project = {
        id: Math.random().toString(36).substring(7),
        name,
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
    if (this.state.projects.length <= 1) return;

    this.state.projects = this.state.projects.filter(p => p.id !== projectId);
    this.state.tasks = this.state.tasks.filter(t => t.projectId !== projectId);

    if (this.state.activeProjectId === projectId) {
        this.state.activeProjectId = this.state.projects[0].id;
    }
    await this.persist();
  }

  async updateProjectName(projectId: string, name: string) {
    this.updateProject(projectId, { name });
    await this.persist();
  }

  async clearProjectLock(projectId: string) {
    this.updateProject(projectId, { targetUrl: undefined });
    await this.persist();
  }

  async updateProjectTargetUrl(projectId: string, targetUrl: string) {
    this.updateProject(projectId, { targetUrl });
    await this.persist();
  }

  // Persist synchronously. A debounced setTimeout is unsafe in an MV3 service
  // worker: the worker can be terminated before the timer fires, silently
  // dropping the write and the UI broadcast (a major source of "lag" and
  // stale UI). We always await the storage write so the worker stays alive
  // until the data is durable, then broadcast immediately.
  private async persist() {
    await saveState(this.state);
    try {
      chrome.runtime.sendMessage(
        { type: 'QUEUE_STATE_UPDATED', payload: this.state },
        () => {
          // Swallow "no receiver" errors when the popup/side panel is closed.
          if (chrome.runtime.lastError) {}
        },
      );
    } catch {
      // sendMessage can throw if no listeners exist; ignore.
    }
  }
}
