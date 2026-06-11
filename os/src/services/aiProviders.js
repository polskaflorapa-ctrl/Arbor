const Anthropic = require('@anthropic-ai/sdk');
const { env } = require('../config/env');

const HF_CHAT_COMPLETIONS_URL = 'https://router.huggingface.co/v1/chat/completions';
const DEFAULT_HF_CHAT_MODEL = 'openai/gpt-oss-20b:fastest';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

let anthropicClient = null;

class AiProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.provider = options.provider;
    this.status = options.status;
    this.configuration = Boolean(options.configuration);
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}

const normalizeProvider = (provider) => {
  const value = String(provider || 'auto').trim().toLowerCase();
  return ['auto', 'anthropic', 'huggingface'].includes(value) ? value : 'auto';
};

const getHuggingFaceToken = () =>
  env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || process.env.HUGGINGFACE_API_TOKEN || '';

const getAiConfigurationStatus = () => {
  const hfToken = getHuggingFaceToken();
  const hfChatModel = env.HF_CHAT_MODEL || DEFAULT_HF_CHAT_MODEL;
  const preferred = normalizeProvider(env.AI_PROVIDER);
  const anthropicConfigured = Boolean(env.ANTHROPIC_API_KEY);
  const huggingFaceConfigured = Boolean(hfToken && hfChatModel);
  const huggingFaceVisionConfigured = Boolean(hfToken && env.HF_VISION_MODEL);

  return {
    preferred,
    anthropicConfigured,
    huggingFaceConfigured,
    huggingFaceVisionConfigured,
    textAvailable:
      preferred === 'anthropic'
        ? anthropicConfigured
        : preferred === 'huggingface'
          ? huggingFaceConfigured
          : anthropicConfigured || huggingFaceConfigured,
    visionAvailable:
      preferred === 'anthropic'
        ? anthropicConfigured
        : preferred === 'huggingface'
          ? huggingFaceVisionConfigured
          : anthropicConfigured || huggingFaceVisionConfigured,
    hfChatModel,
    hfVisionModel: env.HF_VISION_MODEL || null,
    anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
  };
};

const getProviderOrder = ({ requiresVision = false } = {}) => {
  const status = getAiConfigurationStatus();
  const providers = [];
  const canUseAnthropic = status.anthropicConfigured;
  const canUseHuggingFace = requiresVision
    ? status.huggingFaceVisionConfigured
    : status.huggingFaceConfigured;

  if (status.preferred === 'anthropic') {
    return canUseAnthropic ? ['anthropic'] : [];
  }
  if (status.preferred === 'huggingface') {
    return canUseHuggingFace ? ['huggingface'] : [];
  }

  if (canUseAnthropic) providers.push('anthropic');
  if (canUseHuggingFace) providers.push('huggingface');
  return providers;
};

const getAnthropicClient = () => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiProviderError('Anthropic API key is not configured', {
      provider: 'anthropic',
      configuration: true,
    });
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
};

const extractTextFromContent = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.content === 'string') return item.content;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
};

const normalizeRole = (role) => (role === 'assistant' || role === 'system' ? role : 'user');

const buildHuggingFaceMessages = ({ system, messages }) => {
  const normalized = [];
  if (system) normalized.push({ role: 'system', content: system });
  messages.forEach((message) => {
    normalized.push({
      role: normalizeRole(message.role),
      content: message.content,
    });
  });
  return normalized;
};

const parseHuggingFaceError = async (response) => {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || parsed.message || text;
  } catch {
    return text;
  }
};

const runAnthropic = async ({ system, messages, maxTokens }) => {
  const model = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    });

    const text = extractTextFromContent(response.content);
    if (!text) {
      throw new AiProviderError('Anthropic returned an empty response', {
        provider: 'anthropic',
        retryable: true,
      });
    }

    return { provider: 'anthropic', model, text };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(error.message || 'Anthropic request failed', {
      provider: 'anthropic',
      status: error.status,
      retryable: error.status == null || error.status >= 500,
      cause: error,
    });
  }
};

const runHuggingFace = async ({ system, messages, maxTokens, requiresVision = false }) => {
  const token = getHuggingFaceToken();
  const model = requiresVision ? env.HF_VISION_MODEL : env.HF_CHAT_MODEL || DEFAULT_HF_CHAT_MODEL;
  if (!token || !model) {
    throw new AiProviderError('Hugging Face is not configured', {
      provider: 'huggingface',
      configuration: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.HF_TIMEOUT_MS || 30000);

  try {
    const response = await fetch(HF_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: buildHuggingFaceMessages({ system, messages }),
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = await parseHuggingFaceError(response);
      throw new AiProviderError(message, {
        provider: 'huggingface',
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const text = extractTextFromContent(choice?.message?.content || choice?.text);
    if (!text) {
      throw new AiProviderError('Hugging Face returned an empty response', {
        provider: 'huggingface',
        retryable: true,
      });
    }

    return { provider: 'huggingface', model, text };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      error.name === 'AbortError' ? 'Hugging Face request timed out' : error.message || 'Hugging Face request failed',
      {
        provider: 'huggingface',
        retryable: true,
        cause: error,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
};

const generateAiText = async ({
  system,
  messages,
  huggingFaceMessages,
  maxTokens = 1024,
  requiresVision = false,
}) => {
  const providers = getProviderOrder({ requiresVision });
  if (providers.length === 0) {
    throw new AiProviderError('AI provider is not configured', {
      provider: 'none',
      configuration: true,
    });
  }

  const preferred = normalizeProvider(env.AI_PROVIDER);
  const failures = [];
  for (const provider of providers) {
    try {
      if (provider === 'anthropic') {
        return await runAnthropic({ system, messages, maxTokens });
      }
      return await runHuggingFace({
        system,
        messages: huggingFaceMessages || messages,
        maxTokens,
        requiresVision,
      });
    } catch (error) {
      failures.push(error);
      if (preferred !== 'auto') throw error;
    }
  }

  const last = failures[failures.length - 1];
  throw last || new AiProviderError('AI provider failed', { provider: 'none', retryable: true });
};

const isAiAuthError = (error) => error?.status === 401 || error?.status === 403;

module.exports = {
  AiProviderError,
  DEFAULT_HF_CHAT_MODEL,
  generateAiText,
  getAiConfigurationStatus,
  isAiAuthError,
};
