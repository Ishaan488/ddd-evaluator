import { postJson, type HttpOptions } from './http.js';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Works for Groq, OpenAI, OpenRouter, Together and anything else that speaks /chat/completions. */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly http: HttpOptions,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { authorization: `Bearer ${this.apiKey}` };
    const body = {
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
    };

    let data: ChatCompletion;
    try {
      data = (await postJson(url, headers, body, this.http)) as ChatCompletion;
    } catch (error) {
      // A few models reject JSON mode. The prompt already demands JSON, so retry without it.
      const unsupported = error instanceof LlmError && error.status === 400 && /response_format|json/i.test(error.message);
      if (!unsupported) throw error;
      const { response_format: _dropped, ...plain } = body;
      data = (await postJson(url, headers, plain, this.http)) as ChatCompletion;
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new LlmError(`${this.name} returned an empty reply.`);
    return {
      text: stripReasoning(text),
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    };
  }
}

/** Some reasoning models put their thinking in <think> tags before the answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
