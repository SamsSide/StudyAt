import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { spaceAudio } from './spaceAudio';
import { resetSpacesStore, useSpacesStore } from './spacesStore';

const seed = (kind: 'video' | 'image' | 'youtube') => {
  const api = mockApi();
  installMockApi(api);
  useSpacesStore.setState({ spaces: [makeSpace({ id: 1, kind })], activeId: 1, loaded: true });
  return api;
};

beforeEach(() => resetSpacesStore());

describe('spaceAudio', () => {
  it('an image space has no audio: canPlayAudio is false and set is a no-op', () => {
    const api = seed('image');
    expect(spaceAudio.canPlayAudio()).toBe(false);
    spaceAudio.set(0.8);
    expect(api.spaces.update).not.toHaveBeenCalled();
    expect(useSpacesStore.getState().spaces[0]?.opts.audio).toBe(false);
  });

  it('a video space can play audio and set saves the volume', () => {
    const api = seed('video');
    expect(spaceAudio.canPlayAudio()).toBe(true);
    spaceAudio.set(0.8);
    expect(api.spaces.update).toHaveBeenCalledWith(1, { opts: { volume: 0.8, audio: true } });
  });

  it('no active space cannot play audio', () => {
    const api = mockApi();
    installMockApi(api);
    expect(spaceAudio.canPlayAudio()).toBe(false);
    spaceAudio.set(0.5);
    expect(api.spaces.update).not.toHaveBeenCalled();
  });
});
