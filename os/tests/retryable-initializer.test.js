const { createRetryableInitializer } = require('../src/lib/retryable-initializer');

describe('createRetryableInitializer', () => {
  test('shares a single in-flight initialization and caches its result', async () => {
    const initialize = jest.fn(async () => ({ ready: true }));
    const getValue = createRetryableInitializer(initialize);

    const [first, second] = await Promise.all([getValue(), getValue()]);
    const third = await getValue();

    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  test('allows a fresh attempt after a transient initialization failure', async () => {
    const initialize = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ ready: true });
    const getValue = createRetryableInitializer(initialize);

    await expect(getValue()).rejects.toThrow('temporary failure');
    await expect(getValue()).resolves.toEqual({ ready: true });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid initializers early', () => {
    expect(() => createRetryableInitializer()).toThrow(TypeError);
  });
});
