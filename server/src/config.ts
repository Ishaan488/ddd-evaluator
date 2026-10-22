import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const modelEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  family: z.string().min(1),
  /** Optional ceiling on the prompt (about 4 characters per token). A prompt over it fails early, with advice. */
  maxInputTokens: z.number().int().positive().optional(),
});

const providerSchema = z.object({
  type: z.enum(['openai-compatible', 'gemini', 'mock']),
  baseUrl: z.string().url().optional(),
  keyEnv: z.string().optional(),
});

export const modelsConfigSchema = z.object({
  /** "provider:model" or "provider:*". Only these may receive project documents. */
  approved: z.array(z.string()),
  providers: z.record(z.string(), providerSchema),
  raters: z.array(modelEntrySchema).length(3, 'the 3 + 1 model needs exactly three raters'),
  consolidator: modelEntrySchema,
  settings: z
    .object({
      temperature: z.number().min(0).max(2).default(0),
      maxOutputTokens: z.number().int().positive().default(8192),
      timeoutMs: z.number().int().positive().default(120_000),
      retries: z.number().int().min(0).max(6).default(3),
    })
    .default({ temperature: 0, maxOutputTokens: 8192, timeoutMs: 120_000, retries: 3 }),
});

export type ModelsConfig = z.infer<typeof modelsConfigSchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ProviderSpec = z.infer<typeof providerSchema>;

export interface AppConfig {
  port: number;
  dataDir: string;
  dbMode: 'postgres' | 'memory';
  databaseUrl: string | undefined;
  mock: boolean;
  mockDelayMs: number;
  models: ModelsConfig;
}

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadModelsConfig(file: string): ModelsConfig {
  const parsed = modelsConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid models config ${file}: ${issues}`);
  }
  return parsed.data;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mock = env.MOCK_LLM === '1';
  const modelsFile =
    env.MODELS_CONFIG ?? path.join(serverDir, 'config', mock ? 'models.mock.json' : 'models.json');
  const databaseUrl = env.DATABASE_URL || undefined;
  const dbMode = env.DB_MODE === 'memory' || !databaseUrl ? 'memory' : 'postgres';
  return {
    port: Number(env.PORT ?? 4000),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(serverDir, '..', 'data')),
    dbMode,
    databaseUrl,
    mock,
    mockDelayMs: Number(env.MOCK_DELAY_MS ?? 700),
    models: loadModelsConfig(modelsFile),
  };
}
