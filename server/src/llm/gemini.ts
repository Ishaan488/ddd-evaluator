import { postJson, type HttpOptions } from './http.js';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

interface GeminiReply {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpOptions,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`;
    const data = (await postJson(
      url,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: 'application/json',
        },
      },
      this.http,
    )) as GeminiReply;

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) {
      const why = data.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no content';
      throw new LlmError(`Gemini returned no text (${why}).`);
    }
    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
}
