import type { ModelsConfig } from '../config.js';

/** Reads the model ids a provider's "list models" endpoint returns. Pure, so it can be tested. */
export function parseModelList(type: 'openai-compatible' | 'gemini', body: unknown): string[] {
  if (type === 'gemini') {
    const models = (body as { models?: Array<{ name?: string }> }).models ?? [];
    return models.flatMap((m) => (m.name ? [m.name.replace(/^models\//, '')] : []));
  }
  const data = (body as { data?: Array<{ id?: string }> }).data ?? [];
  return data.flatMap((m) => (m.id ? [m.id] : []));
}

export function listModelsRequest(
  provider: ModelsConfig['providers'][string],
  key: string,
): { url: string; headers: Record<string, string> } | null {
  if (provider.type === 'gemini') {
    return {
      url: `${provider.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'}/models?pageSize=200`,
      headers: { 'x-goog-api-key': key },
    };
  }
  if (provider.type === 'openai-compatible' && provider.baseUrl) {
    return { url: `${provider.baseUrl.replace(/\/$/, '')}/models`, headers: { authorization: `Bearer ${key}` } };
  }
  return null;
}
