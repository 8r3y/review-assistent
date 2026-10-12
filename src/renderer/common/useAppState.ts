import { useEffect, useState } from 'react';
import type { AppState } from '@shared/ipc';

/** Current AppState from main, kept in sync via the `app:state` event. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    const unsubscribe = window.api.on('app:state', setState);
    void window.api.invoke('app:get-state').then(setState);
    return unsubscribe;
  }, []);
  return state;
}

/** Re-renders every `intervalMs`, returning Date.now(). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
