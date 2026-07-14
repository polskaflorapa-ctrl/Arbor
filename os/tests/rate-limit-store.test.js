const ORIGINAL_ENV = { ...process.env };

function loadRateLimitModule(envOverrides = {}, { redisMock, redisStoreMock } = {}) {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '40',
    LOGIN_RATE_LIMIT_STORE: 'memory',
    LOGIN_RATE_LIMIT_REDIS_URL: '',
    ...envOverrides,
  };

  if (redisMock) {
    jest.doMock('redis', () => redisMock, { virtual: true });
  }
  if (redisStoreMock) {
    jest.doMock('rate-limit-redis', () => redisStoreMock, { virtual: true });
  }

  return require('../src/middleware/rate-limit');
}

describe('auth limiter store factory', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses MemoryStore by default', () => {
    const { __createLoginLimiterStore } = loadRateLimitModule();
    const store = __createLoginLimiterStore();

    expect(store.constructor?.name).toBe('MemoryStore');
  });

  it('falls back to MemoryStore when redis is selected but URL is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { __createLoginLimiterStore } = loadRateLimitModule({
      LOGIN_RATE_LIMIT_STORE: 'redis',
      LOGIN_RATE_LIMIT_REDIS_URL: '',
    });

    const store = __createLoginLimiterStore();

    expect(store.constructor?.name).toBe('MemoryStore');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('LOGIN_RATE_LIMIT_STORE=redis'));
    warnSpy.mockRestore();
  });

  it('creates redis-backed store when redis modules and URL are available', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const sendCommand = jest.fn().mockResolvedValue('PONG');
    const createClient = jest.fn(() => ({
      isOpen: false,
      connect,
      sendCommand,
    }));

    class MockRedisStore {
      constructor(options) {
        this.options = options;
      }

      init() {}
      increment() {}
      decrement() {}
      resetKey() {}
    }

    const { __createLoginLimiterStore } = loadRateLimitModule(
      {
        LOGIN_RATE_LIMIT_STORE: 'redis',
        LOGIN_RATE_LIMIT_REDIS_URL: 'redis://127.0.0.1:6379',
      },
      {
        redisMock: { createClient },
        redisStoreMock: { default: MockRedisStore },
      }
    );

    const store = __createLoginLimiterStore();

    expect(store).toBeInstanceOf(MockRedisStore);
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });
    // Wszystkie limitery auth współdzielą JEDEN klient Redis (jedno połączenie
    // per proces), niezależnie od liczby sklepów utworzonych przy imporcie modułu.
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(store.options.prefix).toBe('arbor:rl:login:');

    await store.options.sendCommand('PING');
    expect(sendCommand).toHaveBeenCalledWith(['PING']);
  });

  it('uses a separate redis namespace for each password reset limiter', () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const createClient = jest.fn(() => ({
      isOpen: false,
      connect,
      sendCommand: jest.fn(),
    }));

    class MockRedisStore {
      constructor(options) {
        this.options = options;
      }

      init() {}
      increment() {}
      decrement() {}
      resetKey() {}
    }

    const { __createAuthLimiterStore } = loadRateLimitModule(
      {
        LOGIN_RATE_LIMIT_STORE: 'redis',
        LOGIN_RATE_LIMIT_REDIS_URL: 'redis://127.0.0.1:6379',
      },
      {
        redisMock: { createClient },
        redisStoreMock: { default: MockRedisStore },
      }
    );

    const forgotStore = __createAuthLimiterStore('forgot-password');
    const confirmStore = __createAuthLimiterStore('reset-password');

    expect(forgotStore.options.prefix).toBe('arbor:rl:forgot-password:');
    expect(confirmStore.options.prefix).toBe('arbor:rl:reset-password:');
  });
});
