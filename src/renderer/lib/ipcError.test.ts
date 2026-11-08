import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from './ipcError';

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
