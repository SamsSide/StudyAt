import { describe, expect, it, vi } from 'vitest';
import { ipcErrorMessage, logIpcError } from './ipcError';

describe('ipcErrorMessage', () => {
  it("strips Electron's remote-method prefix", () => {
    const e = new Error("Error invoking remote method 'settings:set': Error: Ctrl+Alt+K is already in use");
    expect(ipcErrorMessage(e)).toBe('Ctrl+Alt+K is already in use');
  });

  it('strips a typed error name too', () => {
    const e = new Error("Error invoking remote method 'x:y': TypeError: bad thing");
    expect(ipcErrorMessage(e)).toBe('bad thing');
  });

  it('leaves a plain message alone', () => {
    expect(ipcErrorMessage(new Error('Nope'))).toBe('Nope');
  });

  it('copes with strings and unknown values', () => {
    expect(ipcErrorMessage("Error invoking remote method 'a:b': Error: Hi")).toBe('Hi');
    expect(ipcErrorMessage(undefined)).toBe('');
    expect(ipcErrorMessage({})).toBe('');
  });
});

describe('logIpcError', () => {
  it("warns with the context and main's reason, without the remote-method prefix", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logIpcError(
      'Exporting failed',
      new Error(
        "Error invoking remote method 'data:exportJson': Error: EACCES: permission denied, open 'C:\\x'",
      ),
    );
    expect(warn).toHaveBeenCalledWith('Exporting failed', "EACCES: permission denied, open 'C:\\x'");
    warn.mockRestore();
  });

  it('passes on a value with no message as it is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const odd = { code: 1 };
    logIpcError('Something failed', odd);
    expect(warn).toHaveBeenCalledWith('Something failed', odd);
    warn.mockRestore();
  });
});
