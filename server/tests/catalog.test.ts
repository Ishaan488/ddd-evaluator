import { describe, expect, it } from 'vitest';
import { listModelsRequest, parseModelList } from '../src/llm/catalog.js';

describe('model catalog', () => {
  it('reads OpenAI-style and Gemini-style model lists', () => {
    expect(parseModelList('openai-compatible', { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }, {}] })).toEqual([
      'llama-3.3-70b-versatile', 'openai/gpt-oss-120b',
    ]);
    expect(parseModelList('gemini', { models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }] })).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(parseModelList('gemini', {})).toEqual([]);
  });

  it('asks each provider for its models the way that provider expects, with the key in a header', () => {
    expect(listModelsRequest({ type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1/' }, 'K')).toEqual({
      url: 'https://api.groq.com/openai/v1/models', headers: { authorization: 'Bearer K' },
    });
    const gemini = listModelsRequest({ type: 'gemini' }, 'G')!;
    expect(gemini.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
    expect(gemini.url).not.toContain('G');
    expect(gemini.headers).toEqual({ 'x-goog-api-key': 'G' });
    expect(listModelsRequest({ type: 'mock' }, 'x')).toBeNull();
  });
});
