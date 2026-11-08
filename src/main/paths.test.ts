import { describe, expect, it, vi } from 'vitest';
import { applyUserDataOverride } from './paths';

function fakeApp(current = 'C:\\Users\\samue\\AppData\\Roaming\\StudyAt') {
  const setPath = vi.fn();
  const getPath = vi.fn(() => current);
  return { app: { setPath, getPath } as unknown as Electron.App, setPath, getPath };
}

describe('applyUserDataOverride', () => {
  it('uses STUDYAT_USER_DATA when set', () => {
    const { app, setPath } = fakeApp();
    const result = applyUserDataOverride(app, { STUDYAT_USER_DATA: '/tmp/studyat-test' });
    expect(setPath).toHaveBeenCalledWith('userData', '/tmp/studyat-test');
    expect(result).toBe('/tmp/studyat-test');
  });

  it('leaves userData alone when unset', () => {
    const { app, setPath } = fakeApp('/home/x/StudyAt');
    expect(applyUserDataOverride(app, {})).toBe('/home/x/StudyAt');
    expect(setPath).not.toHaveBeenCalled();
  });

  it('ignores an empty value', () => {
    const { app, setPath } = fakeApp('/home/x/StudyAt');
    expect(applyUserDataOverride(app, { STUDYAT_USER_DATA: '' })).toBe('/home/x/StudyAt');
    expect(setPath).not.toHaveBeenCalled();
  });
});
