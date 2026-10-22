import { sha256 } from '../util/hash.js';
import { errorMessage } from '../util/errors.js';
import type { LlmProvider } from '../llm/types.js';

export interface CallSettings {
  temperature: number;
  maxOutputTokens: number;
}

export interface CallArgs<T> {
  provider: LlmProvider;
  model: string;
  system: string;
  user: string;
  settings: CallSettings;
  /** Parses and validates the raw reply; throws with a readable message when it is unusable. */
  parse(raw: string): T;
}

export interface CallResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  raw: string;
  attempts: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  promptHash: string;
}

const MAX_ATTEMPTS = 2;

function addTokens(total: number | null, next: number | null): number | null {
  if (next === null) return total;
  return (total ?? 0) + next;
}

/**
 * Calls a model and checks the reply. If the reply is not usable it asks once more,
 * telling the model what was wrong; after that the call is reported as failed.
 */
export async function callJsonModel<T>(args: CallArgs<T>): Promise<CallResult<T>> {
  const result: CallResult<T> = {
    ok: false,
    raw: '',
    attempts: 0,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
    promptHash: sha256(`${args.system}\n${args.user}`),
  };
  let problem = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;
    const user =
      attempt === 1
        ? args.user
        : `${args.user}\n\n<previous_reply_problem>${problem}</previous_reply_problem>\nReply again with one valid JSON object in the required shape and nothing else.`;
    const started = Date.now();
    let text: string;
    try {
      const reply = await args.provider.complete({
        model: args.model,
        system: args.system,
        user,
        temperature: args.settings.temperature,
        maxOutputTokens: args.settings.maxOutputTokens,
      });
      text = reply.text;
      result.inputTokens = addTokens(result.inputTokens, reply.inputTokens);
      result.outputTokens = addTokens(result.outputTokens, reply.outputTokens);
    } catch (error) {
      // A transport error was already retried by the HTTP layer; asking again would not help.
      result.latencyMs += Date.now() - started;
      result.error = errorMessage(error);
      return result;
    }
    result.latencyMs += Date.now() - started;
    result.raw = text;

    try {
      result.value = args.parse(text);
      result.ok = true;
      return result;
    } catch (error) {
      problem = errorMessage(error);
    }
  }
  result.error = `The reply was not usable after ${MAX_ATTEMPTS} attempts: ${problem}`;
  return result;
}

/** Pulls a JSON object out of a reply, tolerating code fences and chatter around it. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('the reply is not a JSON object');
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (error) {
      throw new Error(`the reply is not valid JSON (${(error as Error).message})`);
    }
  }
}
