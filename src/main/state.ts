import type { AppState } from '@shared/ipc';

type Listener = (state: AppState) => void;

/** Single source of truth for UI-visible state; every change is broadcast to renderers. */
export class AppStore {
  private listeners = new Set<Listener>();

  constructor(private state: AppState) {}

  get(): AppState {
    return this.state;
  }

  update(patch: (current: AppState) => AppState): void {
    this.state = patch(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
