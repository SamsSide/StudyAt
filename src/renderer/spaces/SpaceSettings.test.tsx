import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { useYouTubeQuality } from './qualityStore';
import { SpaceSettings } from './SpaceSettings';
import { resetSpacesStore } from './spacesStore';
import { QUALITY_HINT } from './youtube';

beforeEach(() => {
  resetSpacesStore();
  useYouTubeQuality.getState().clear();
  installMockApi(mockApi());
});

describe('SpaceSettings', () => {
  it("a YouTube space's speed steps by 0.25, the rates the player supports", () => {
    render(<SpaceSettings space={makeSpace({ id: 3, kind: 'youtube' })} onClose={() => undefined} />);
    const speed = screen.getByRole('slider', { name: 'Speed' });
    expect(speed).toHaveAttribute('step', '0.25');
    expect(speed).toHaveAttribute('min', '0.5');
    expect(speed).toHaveAttribute('max', '1.5');
  });

  it("a local video's speed keeps its fine 0.05 step", () => {
    render(<SpaceSettings space={makeSpace({ id: 1, kind: 'video' })} onClose={() => undefined} />);
    expect(screen.getByRole('slider', { name: 'Speed' })).toHaveAttribute('step', '0.05');
  });

  describe('quality', () => {
    it('a YouTube space shows the control with Auto pressed and the hint', () => {
      render(<SpaceSettings space={makeSpace({ id: 3, kind: 'youtube' })} onClose={() => undefined} />);
      const group = screen.getByRole('group', { name: 'Quality' });
      expect(within(group).getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
      expect(
        within(group)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Auto', '1080p', '1440p', '4K']);
      expect(screen.getByText(QUALITY_HINT)).toBeInTheDocument();
    });

    it('choosing 4K saves opts.quality', async () => {
      const update = vi.fn(() => Promise.resolve([]));
      installMockApi(mockApi({ spaces: { update } }));
      render(<SpaceSettings space={makeSpace({ id: 3, kind: 'youtube' })} onClose={() => undefined} />);
      await userEvent.click(screen.getByRole('button', { name: '4K' }));
      expect(update).toHaveBeenCalledWith(3, { opts: { quality: '2160' } });
    });

    it('video and image spaces have no Quality control', () => {
      const { unmount } = render(
        <SpaceSettings space={makeSpace({ id: 1, kind: 'video' })} onClose={() => undefined} />,
      );
      expect(screen.queryByRole('group', { name: 'Quality' })).not.toBeInTheDocument();
      unmount();
      render(<SpaceSettings space={makeSpace({ id: 2, kind: 'image' })} onClose={() => undefined} />);
      expect(screen.queryByRole('group', { name: 'Quality' })).not.toBeInTheDocument();
    });

    it('the badge reads what the store says, and a dash otherwise', () => {
      render(<SpaceSettings space={makeSpace({ id: 3, kind: 'youtube' })} onClose={() => undefined} />);
      expect(screen.getByRole('status', { name: 'Playing quality' })).toHaveTextContent('—');
      act(() => useYouTubeQuality.getState().report({ spaceId: 3, level: 'hd2160', playing: true }));
      expect(screen.getByRole('status', { name: 'Playing quality' })).toHaveTextContent('Playing · 2160p');
    });
  });
});
