import { LlmError } from './types.js';

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function waitTime(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000 + 250, MAX_WAIT_MS);
  return Math.min(1000 * 2 ** attempt + Math.random() * 250, MAX_WAIT_MS);
}

/** POSTs JSON and returns the parsed body. Retries rate limits, server errors and timeouts. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: LlmError | undefined;

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    let retryAfter: string | null = null;
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const text = await response.text();
      if (response.ok) {
        try {
          return JSON.parse(text);
        } catch {
          throw new LlmError('The provider returned a body that is not JSON.');
        }
      }
      retryAfter = response.headers.get('retry-after');
      lastError = new LlmError(`HTTP ${response.status}: ${text.slice(0, 400)}`, response.status);
      if (!RETRYABLE.has(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof LlmError && !RETRYABLE.has(error.status ?? 0)) throw error;
      lastError =
        error instanceof LlmError
          ? error
          : new LlmError(`Request failed: ${(error as Error).message}`);
    }
    if (attempt < options.retries) await sleep(waitTime(attempt, retryAfter));
  }
  throw lastError ?? new LlmError('Request failed.');
}
