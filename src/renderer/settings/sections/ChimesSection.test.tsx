import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import type { PublicSettings } from '../../../shared/types';
import type * as UseChimes from '../../audio/useChimes';
import { installMockApi, mockApi } from '../../test/mockApi';
import { resetStudyStore } from '../../shell/store';

const cancels: Array<ReturnType<typeof vi.fn>> = [];
vi.mock('../../audio/useChimes', async (importOriginal) => ({
  ...(await importOriginal<typeof UseChimes>()),
  playCountdownPreview: vi.fn(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return cancel;
  }),
}));

import { playCountdownPreview } from '../../audio/useChimes';
import { ChimesSection } from './ChimesSection';

const settings = (): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return rest;
};

const mount = () => {
  installMockApi(mockApi());
  return render(
    <ChimesSection
      settings={settings()}
      update={vi.fn(() => Promise.resolve(true))}
      updateOrThrow={vi.fn(() => Promise.resolve())}
    />,
  );
};

beforeEach(() => {
  resetStudyStore();
  cancels.length = 0;
  vi.mocked(playCountdownPreview).mockClear();
});

describe('ChimesSection countdown preview', () => {
  it('cancels the running preview before starting a new one', async () => {
    mount();
    const button = screen.getByRole('button', { name: 'Preview' });
    await userEvent.click(button);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(cancels).toHaveLength(2);
    expect(cancels[0]).toHaveBeenCalledTimes(1);
    expect(cancels[1]).not.toHaveBeenCalled();
  });

  it('cancels the running preview on unmount', async () => {
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    view.unmount();
    expect(cancels[0]).toHaveBeenCalledTimes(1);
  });
});
