// Electron prefixes a rejected `ipcRenderer.invoke` with "Error invoking remote method '<channel>': Error: ".
// Show people only the message main wrote.
const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/;

/** The human-readable text of a rejection from the preload bridge; '' when there is none. */
export function ipcErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return raw.replace(IPC_PREFIX, '');
}
