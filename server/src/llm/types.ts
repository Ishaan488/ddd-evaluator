export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}
