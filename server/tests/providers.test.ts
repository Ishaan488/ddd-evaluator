import { describe, expect, it } from 'vitest';
import { GeminiProvider } from '../src/llm/gemini.js';
import { OpenAiCompatibleProvider, stripReasoning } from '../src/llm/openaiCompatible.js';
import { errorDetail } from '../src/llm/http.js';
import { createProviderFactory } from '../src/llm/registry.js';
import { LlmError } from '../src/llm/types.js';
import { mockModels } from './helpers.js';
import { modelsConfigSchema } from '../src/config.js';

const request = { model: 'm', system: 'sys', user: 'usr', temperature: 0, maxOutputTokens: 100 };
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const noSleep = async () => undefined;

function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more scripted responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('OpenAI-compatible provider (Groq, OpenAI, OpenRouter)', () => {
  it('sends a chat completion with JSON mode and returns text and token counts', async () => {
    const { fetchImpl, calls } = scripted([reply(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } })]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://api.groq.com/openai/v1/', 'KEY', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    expect(await provider.complete(request)).toEqual({ text: '{"ok":true}', inputTokens: 10, outputTokens: 4 });
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent).toMatchObject({ model: 'm', temperature: 0, max_tokens: 100, response_format: { type: 'json_object' } });
    expect(sent.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer KEY');
  });

  it('retries a rate limit, waiting as long as the provider says', async () => {
    const waits: number[] = [];
    const { fetchImpl } = scripted([reply(429, 'slow down', { 'retry-after': '2' }), reply(200, { choices: [{ message: { content: 'hi' } }] })]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 2, fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect((await provider.complete(request)).text).toBe('hi');
    expect(waits).toEqual([2250]);
  });

  it('gives up after the retries and says why, without ever including the API key', async () => {
    const { fetchImpl } = scripted([reply(503, 'down'), reply(503, 'down'), reply(503, 'down')]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'SECRET-KEY', { timeoutMs: 1000, retries: 2, fetchImpl, sleep: noSleep });
    const error = await provider.complete(request).catch((e: Error) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as Error).message).toMatch(/HTTP 503/);
    expect((error as Error).message).not.toContain('SECRET-KEY');
  });

  it('shows the provider\'s sentence, not the raw JSON, so the dashboard message is readable', async () => {
    const groq = JSON.stringify({ error: { message: 'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 18336, please reduce your message size', type: 'tokens', code: 'rate_limit_exceeded' } });
    const { fetchImpl } = scripted([reply(413, groq)]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    const error = (await provider.complete(request).catch((e: Error) => e)) as Error;
    expect(error.message).toBe('HTTP 413: Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 18336, please reduce your message size');
    const gemini = [{ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }];
    expect(errorDetail(JSON.stringify(gemini))).toBe('This model is currently experiencing high demand.');
    expect(errorDetail('plain text failure')).toBe('plain text failure');
  });

  it('does not retry a request the provider rejects as invalid', async () => {
    const { fetchImpl, calls } = scripted([reply(401, 'bad key')]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 3, fetchImpl, sleep: noSleep });
    await expect(provider.complete(request)).rejects.toThrow(/HTTP 401/);
    expect(calls).toHaveLength(1);
  });

  it('retries without JSON mode when a model refuses it', async () => {
    const { fetchImpl, calls } = scripted([reply(400, 'response_format is not supported'), reply(200, { choices: [{ message: { content: '{}' } }] })]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    await provider.complete(request);
    expect(JSON.parse(calls[1]!.init.body as string)).not.toHaveProperty('response_format');
  });

  it('retries after a network failure, and strips <think> blocks from reasoning models', async () => {
    const { fetchImpl } = scripted([new Error('socket hang up'), reply(200, { choices: [{ message: { content: '<think>hmm</think>\n{"a":1}' } }] })]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 1, fetchImpl, sleep: noSleep });
    expect((await provider.complete(request)).text).toBe('{"a":1}');
    expect(stripReasoning('<think>a\nb</think>{"x":1}')).toBe('{"x":1}');
  });

  it('reports an empty reply instead of passing it on', async () => {
    const { fetchImpl } = scripted([reply(200, { choices: [{ message: { content: null } }] })]);
    const provider = new OpenAiCompatibleProvider('groq', 'https://x', 'K', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    await expect(provider.complete(request)).rejects.toThrow(/empty reply/);
  });
});

describe('Gemini provider', () => {
  it('sends the key in a header (never in the URL) and reads text and usage', async () => {
    const { fetchImpl, calls } = scripted([reply(200, { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } })]);
    const provider = new GeminiProvider('G-KEY', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    expect(await provider.complete({ ...request, model: 'gemini-2.5-flash' })).toEqual({ text: '{"a":1}', inputTokens: 7, outputTokens: 3 });
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(calls[0]!.url).not.toContain('G-KEY');
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('G-KEY');
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent.generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: 100, responseMimeType: 'application/json' });
    expect(sent.systemInstruction.parts[0].text).toBe('sys');
  });

  it('explains a blocked or empty reply', async () => {
    const { fetchImpl } = scripted([reply(200, { promptFeedback: { blockReason: 'SAFETY' } })]);
    const provider = new GeminiProvider('K', { timeoutMs: 1000, retries: 0, fetchImpl, sleep: noSleep });
    await expect(provider.complete(request)).rejects.toThrow(/no text \(SAFETY\)/);
  });
});

describe('provider factory', () => {
  it('builds providers from the config and the environment, and refuses a missing key', () => {
    const models = modelsConfigSchema.parse({
      approved: ['groq:*', 'gemini:*'],
      providers: { groq: { type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' }, gemini: { type: 'gemini', keyEnv: 'GEMINI_API_KEY' } },
      raters: [
        { id: 'A', provider: 'groq', model: 'm1', family: 'a' }, { id: 'B', provider: 'gemini', model: 'm2', family: 'b' }, { id: 'C', provider: 'groq', model: 'm3', family: 'c' },
      ],
      consolidator: { id: 'K', provider: 'groq', model: 'm4', family: 'd' },
    });
    const make = createProviderFactory(models, { env: { GROQ_API_KEY: 'g' } });
    expect(make('groq').name).toBe('groq');
    expect(make('groq')).toBe(make('groq'));
    expect(() => make('gemini')).toThrow(/no API key \(GEMINI_API_KEY\)/);
    expect(() => make('nope')).toThrow(/not configured/);
    expect(createProviderFactory(mockModels())('mock').name).toBe('mock');
  });
});
