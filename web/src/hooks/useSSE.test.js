import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { useSSE } from './useSSE';
import { resetAuthSession } from '../utils/authSession';
import { isTestModeEnabled } from '../utils/testMode';

vi.mock('../utils/storedToken', () => ({
  getStoredToken: vi.fn(() => 'jwt-token'),
}));

vi.mock('../utils/authSession', () => ({
  resetAuthSession: vi.fn(),
}));

vi.mock('../utils/testMode', () => ({
  isTestModeEnabled: vi.fn(() => false),
}));

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.close = vi.fn();
    FakeEventSource.instances.push(this);
  }
}

function Harness() {
  useSSE(vi.fn());
  return null;
}

describe('useSSE', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    global.EventSource = FakeEventSource;
    global.fetch = vi.fn(() => new Promise(() => {}));
    resetAuthSession.mockClear();
    isTestModeEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.EventSource;
    vi.restoreAllMocks();
  });

  it('does not schedule reconnect after unmount while auth validation is pending', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const view = render(<Harness />);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      FakeEventSource.instances[0].onerror();
    });
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();

    view.unmount();

    await act(async () => {
      resolveFetch({ status: 503 });
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(resetAuthSession).not.toHaveBeenCalled();
  });

  it('resets auth session when SSE auth validation returns 401', async () => {
    global.fetch = vi.fn(async () => ({ status: 401 }));

    render(<Harness />);
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      FakeEventSource.instances[0].onerror();
      await Promise.resolve();
    });

    expect(resetAuthSession).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reconnects with backoff when auth validation fails without 401', async () => {
    global.fetch = vi.fn(async () => ({ status: 503 }));

    render(<Harness />);
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      FakeEventSource.instances[0].onerror();
      await Promise.resolve();
    });

    expect(resetAuthSession).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('does not open SSE in test mode', () => {
    isTestModeEnabled.mockReturnValue(true);

    render(<Harness />);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
