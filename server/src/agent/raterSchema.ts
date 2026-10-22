import { z } from 'zod';

const RETURN_TO = ['Discover', 'Define', 'Generate', 'Analyse', 'Validate', 'Refine'] as const;

export const cellSchema = z.object({
  sheet: z.string(),
  cell: z.string(),
  quote: z.string().nullish(),
});

/** Models sometimes send "4" instead of 4. */
const score = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value),
  z.number().nullable(),
);

const severity = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(['HIGH', 'MEDIUM', 'LOW']),
);

const returnTo = z.enum(RETURN_TO).optional().catch(undefined);

export const raterDimensionSchema = z.object({
  id: z.string(),
  score: score.default(null),
  not_measurable: z.boolean().optional().default(false),
  anchor: z.string().nullish(),
  rationale: z.string().optional().default(''),
  evidence: z.array(cellSchema).optional().default([]),
});

export const findingSchema = z.object({
  dimension: z.string(),
  severity,
  title: z.string().min(1),
  detail: z.string().optional().default(''),
  location: cellSchema.nullish(),
  fix: z.string().optional().default(''),
  return_to: returnTo,
});

export const strengthSchema = z.object({
  dimension: z.string(),
  text: z.string().min(1),
  location: cellSchema.nullish(),
});

/** The top-level shape; items are checked one by one so a single bad item never sinks a reply. */
export const raterReplySchema = z.object({
  dimensions: z.array(z.unknown()),
  findings: z.array(z.unknown()).optional().default([]),
  strengths: z.array(z.unknown()).optional().default([]),
});

export const consolidatorDimensionSchema = z.object({
  id: z.string(),
  score,
  resolved: z.boolean().optional().default(true),
  basis: z.string().optional(),
  rationale: z.string().optional().default(''),
  evidence: z.array(cellSchema).optional().default([]),
});

export const consolidatorFindingSchema = findingSchema.extend({
  from: z.array(z.string()).optional().default([]),
});

export const consolidatorReplySchema = z.object({
  dimensions: z.array(z.unknown()),
  findings: z.array(z.unknown()).optional().default([]),
  strengths: z.array(z.unknown()).optional().default([]),
});
