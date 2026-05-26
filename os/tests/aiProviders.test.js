const AI_ENV_KEYS = [
  'AI_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'HUGGINGFACE_API_TOKEN',
  'HF_CHAT_MODEL',
  'HF_VISION_MODEL',
  'HF_TIMEOUT_MS',
];

const ORIGINAL_AI_ENV = Object.fromEntries(AI_ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_FETCH = global.fetch;

const clearAiEnv = () => {
  AI_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
};

const restoreAiEnv = () => {
  clearAiEnv();
  Object.entries(ORIGINAL_AI_ENV).forEach(([key, value]) => {
    if (value !== undefined) process.env[key] = value;
  });
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  global.fetch = ORIGINAL_FETCH;
};

const loadProviders = (env = {}) => {
  jest.resetModules();
  clearAiEnv();
  process.env.NODE_ENV = 'test';
  Object.assign(process.env, env);
  return require('../src/services/aiProviders');
};

describe('AI providers', () => {
  afterEach(() => {
    restoreAiEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('calls Hugging Face router with OpenAI-compatible chat payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Plan gotowy' } }] }),
    });

    const { generateAiText } = loadProviders({
      AI_PROVIDER: 'huggingface',
      HF_TOKEN: 'hf_test',
      HF_CHAT_MODEL: 'test/model:fastest',
      HF_TIMEOUT_MS: '5000',
    });

    const result = await generateAiText({
      system: 'System ARBOR',
      messages: [{ role: 'user', content: 'Co dzisiaj robimy?' }],
      maxTokens: 111,
    });

    expect(result).toEqual({
      provider: 'huggingface',
      model: 'test/model:fastest',
      text: 'Plan gotowy',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://router.huggingface.co/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer hf_test',
          'Content-Type': 'application/json',
        }),
        signal: expect.any(Object),
      })
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'test/model:fastest',
      messages: [
        { role: 'system', content: 'System ARBOR' },
        { role: 'user', content: 'Co dzisiaj robimy?' },
      ],
      max_tokens: 111,
      stream: false,
    });
  });

  it('reports missing configuration without calling remote providers', async () => {
    global.fetch = jest.fn();
    const { generateAiText } = loadProviders({ AI_PROVIDER: 'huggingface' });

    await expect(generateAiText({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toMatchObject({
      provider: 'none',
      configuration: true,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces Hugging Face API errors with provider metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'bad token' } }),
    });

    const { generateAiText } = loadProviders({
      AI_PROVIDER: 'huggingface',
      HF_TOKEN: 'hf_bad',
      HF_CHAT_MODEL: 'test/model',
    });

    await expect(generateAiText({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toMatchObject({
      provider: 'huggingface',
      status: 401,
      message: 'bad token',
    });
  });
});
