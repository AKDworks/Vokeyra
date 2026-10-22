import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../src/main/host', () => ({ host: mocks.host }));

import { RecordingOverlay } from '../src/main/tauri-overlay';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host.mockResolvedValue(undefined);
});

describe('recording overlay lifecycle', () => {
  it('shows at the configured edge and publishes state to the overlay window only', async () => {
    const overlay = new RecordingOverlay();
    overlay.setPosition('top');
    overlay.show();
    expect(mocks.host).toHaveBeenCalledWith('overlay:show', 'top');
    overlay.update({ phase: 'recording', level: 0.4, seconds: 3 });
    expect(mocks.host).toHaveBeenCalledWith('overlay:update', expect.objectContaining({
      phase: 'recording', level: 0.4, seconds: 3, overlayMode: 'realtime',
    }));
  });

  it('keeps the application language when level updates arrive', () => {
    const overlay = new RecordingOverlay();
    overlay.setLanguage('en');
    overlay.update({ phase: 'recording', level: 0.1, seconds: 1 });
    expect(overlay.state.appLanguage).toBe('en');
    expect(mocks.host).toHaveBeenLastCalledWith('overlay:update', expect.objectContaining({ appLanguage: 'en' }));
  });

  it('hides on cancel, on error and when overlay mode is disabled', async () => {
    const overlay = new RecordingOverlay();
    overlay.show();
    overlay.hide();
    expect(mocks.host).toHaveBeenCalledWith('overlay:hide');
    overlay.show();
    overlay.setMode('none');
    expect(mocks.host.mock.calls.filter(([method]) => method === 'overlay:hide')).toHaveLength(2);
    expect(mocks.host).toHaveBeenLastCalledWith('overlay:update', expect.objectContaining({ overlayMode: 'realtime' }));
  });

  it('never breaks recording when the host cannot create the overlay', async () => {
    mocks.host.mockRejectedValue(new Error('layer-shell unavailable'));
    const overlay = new RecordingOverlay();
    expect(() => overlay.show()).not.toThrow();
    expect(() => overlay.hide()).not.toThrow();
    await Promise.resolve();
  });
});
