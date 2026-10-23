import type { ModelsConfig } from '../config.js';
import { UserError } from '../util/errors.js';
import { BedrockProvider, bedrockRegion } from './bedrock.js';
import { GeminiProvider } from './gemini.js';
import type { HttpOptions } from './http.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatibleProvider } from './openaiCompatible.js';
import type { LlmProvider } from './types.js';

export type ProviderFactory = (name: string) => LlmProvider;

export interface FactoryOptions {
  env?: NodeJS.ProcessEnv;
  mockDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Builds providers lazily from the config. API keys are read from the environment only. */
export function createProviderFactory(models: ModelsConfig, options: FactoryOptions = {}): ProviderFactory {
  const env = options.env ?? process.env;
  const cache = new Map<string, LlmProvider>();
  const http: HttpOptions = {
    timeoutMs: models.settings.timeoutMs,
    retries: models.settings.retries,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  };

  return (name) => {
    const cached = cache.get(name);
    if (cached) return cached;
    const spec = models.providers[name];
    if (!spec) throw new UserError(`Provider "${name}" is not configured.`, 409);

    let provider: LlmProvider;
    if (spec.type === 'mock') {
      provider = new MockProvider(options.mockDelayMs ?? 0);
    } else {
      const key = spec.keyEnv ? env[spec.keyEnv] : undefined;
      if (!key) throw new UserError(`Provider "${name}" has no API key (${spec.keyEnv}).`, 409);
      if (spec.type === 'gemini') provider = new GeminiProvider(key, http, spec.baseUrl);
      else if (spec.type === 'bedrock') {
        provider = new BedrockProvider(key, http, spec.baseUrl ?? `https://bedrock-runtime.${bedrockRegion(spec.region, env)}.amazonaws.com`);
      } else provider = new OpenAiCompatibleProvider(name, spec.baseUrl ?? '', key, http);
    }
    cache.set(name, provider);
    return provider;
  };
}
