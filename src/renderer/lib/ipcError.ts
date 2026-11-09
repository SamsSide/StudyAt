// Electron prefixes a rejected `ipcRenderer.invoke` with "Error invoking remote method '<channel>': Error: ".
// Show people only the message main wrote.
const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/;

/** The human-readable text of a rejection from the preload bridge; '' when there is none. */
export function ipcErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return raw.replace(IPC_PREFIX, '');
}

/**
 * Logs a failed call for whoever debugs it, with main's reason. People never see that reason: the
 * UI shows its own fixed sentence (ruling R38), except where main's text is designed copy (the
 * global-hotkey refusal, Spotify's port-in-use message).
 */
export function logIpcError(context: string, e: unknown): void {
  console.warn(context, ipcErrorMessage(e) || e);
}
