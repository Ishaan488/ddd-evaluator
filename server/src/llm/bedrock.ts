import { postJson, type HttpOptions } from './http.js';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

interface ConverseReply {
  output?: { message?: { content?: Array<{ text?: string }> } };
  usage?: { inputTokens?: number; outputTokens?: number };
  stopReason?: string;
}

export const DEFAULT_BEDROCK_REGION = 'us-east-1';

/** The region a Bedrock provider talks to: AWS_REGION wins, then the config, then us-east-1. */
export const bedrockRegion = (configured: string | undefined, env: NodeJS.ProcessEnv = process.env) =>
  env.AWS_REGION || configured || DEFAULT_BEDROCK_REGION;

/** Inference-profile ids start with a region group ("us.", "eu.", "apac.", "global."); the model list shows the bare id. */
export const bedrockBaseId = (modelId: string) => modelId.replace(/^(us-gov|us|eu|apac|global)\./, '');

/**
 * Amazon Bedrock through its Converse API, which takes the same request for every model family
 * (Claude, Llama, Mistral, Nova, ...). Authenticates with a Bedrock API key sent as a bearer token.
 */
export class BedrockProvider implements LlmProvider {
  readonly name = 'bedrock';

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpOptions,
    private readonly baseUrl: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    // Model ids contain ":" and sometimes "/" (ARNs), so they must be encoded into the path.
    const url = `${this.baseUrl.replace(/\/$/, '')}/model/${encodeURIComponent(request.model)}/converse`;
    const data = (await postJson(
      url,
      { authorization: `Bearer ${this.apiKey}` },
      {
        system: [{ text: request.system }],
        messages: [{ role: 'user', content: [{ text: request.user }] }],
        inferenceConfig: { temperature: request.temperature, maxTokens: request.maxOutputTokens },
      },
      this.http,
    )) as ConverseReply;

    // Reasoning models add non-text blocks (their thinking); only the text blocks are the answer.
    const text = data.output?.message?.content?.map((block) => block.text ?? '').join('').trim();
    if (!text) throw new LlmError(`Bedrock returned no text (${data.stopReason ?? 'no content'}).`);
    return { text, inputTokens: data.usage?.inputTokens ?? null, outputTokens: data.usage?.outputTokens ?? null };
  }
}
