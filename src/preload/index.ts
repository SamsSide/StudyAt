// The preload (sandboxed, context-isolated; study-dev rule 5): exposes `window.studyat` and nothing
// else. The API is built from CHANNELS in src/shared/ipc.ts.
import { contextBridge, ipcRenderer } from 'electron';
import { buildApi } from './api';

contextBridge.exposeInMainWorld('studyat', buildApi(ipcRenderer));
