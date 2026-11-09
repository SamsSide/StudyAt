import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { SpaceSettings } from './SpaceSettings';
import { resetSpacesStore } from './spacesStore';

beforeEach(() => {
  resetSpacesStore();
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
});
