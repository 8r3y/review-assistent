import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type RendererApi } from '@shared/ipc';

const invokeAllowed = new Set<string>(INVOKE_CHANNELS);
const eventAllowed = new Set<string>(EVENT_CHANNELS);

/** Exposes a typed, allow-listed IPC surface as `window.api`. */
export function exposeApi(): void {
  const api: RendererApi = {
    invoke: (channel, ...args) => {
      if (!invokeAllowed.has(channel))
        return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, listener) => {
      if (!eventAllowed.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
      const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void =>
        (listener as (...a: unknown[]) => void)(...args);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
  };
  contextBridge.exposeInMainWorld('api', api);
}
