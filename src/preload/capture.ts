/// <reference lib="dom" />
import { ipcRenderer } from 'electron';
import { exposeApi } from './expose';

exposeApi();

// MessagePorts cannot cross contextBridge; relay the PCM port to the page via window.postMessage.
ipcRenderer.on('capture:port', (event) => {
  window.postMessage('capture:port', '*', event.ports);
});
