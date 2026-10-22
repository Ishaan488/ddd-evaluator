import { z } from 'zod';
import type { Scorecard } from './types.js';

/**
 * Parses the scorecard file format (PDF page 17) into the domain `Scorecard`.
 * The file keeps the PDF's snake_case; the domain object is camelCase.
 * Accepted PDF shortcuts: `judges: "D1 schema · Step 01"`, `measurable_by_agent: false`,
 * `thresholds: { accept, refine }`, anchors keyed 0-5.
 */

const RETURN_TO = ['Discover', 'Define', 'Generate', 'Analyse', 'Validate', 'Refine'] as const;

const bandSchema = z.object({
  min: z.number().min(0).max(1),
  score: z.number().int().min(0).max(5),
});

const checkSchema = z.object({
  id: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  bands: z.array(bandSchema).min(1),
  fix: z.string().optional(),
});

const anchorsSchema = z.record(z.string(), z.string()).superRefine((anchors, ctx) => {
  for (const level of ['0', '1', '2', '3', '4', '5']) {
    if (!anchors[level]) {
      ctx.addIssue({ code: 'custom', message: `anchor for score ${level} is missing` });
    }
  }
});

const sheetSchema = z.preprocess(
  (value) => (typeof value === 'string' ? { name: value } : value),
  z.object({
    name: z.string().min(1),
    header_row: z.number().int().min(1).default(1),
    columns: z.array(z.string().min(1)).min(1).optional(),
  }),
);

const dimensionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'use letters, digits, - or _'),
    name: z.string().min(1),
    weight: z.number().positive(),
    critical: z.boolean().default(false),
    measured_by: z.enum(['code', 'raters', 'human']).optional(),
    measurable_by_agent: z.boolean().optional(),
    description: z.string().optional(),
    measure: z.string().optional(),
    anchors: anchorsSchema.optional(),
    check: checkSchema.optional(),
    needs: z.string().optional(),
    return_to: z.enum(RETURN_TO).optional(),
    reads: z.array(z.string().min(1)).optional(),
  })
  .superRefine((dim, ctx) => {
    const measuredBy = resolveMeasuredBy(dim);
    if (measuredBy === 'code' && !dim.check) {
      ctx.addIssue({ code: 'custom', message: 'a code dimension needs a `check`' });
    }
    if (measuredBy === 'raters' && !dim.anchors) {
      ctx.addIssue({ code: 'custom', message: 'a rater dimension needs `anchors` for scores 0-5' });
    }
  });

function resolveMeasuredBy(dim: {
  measured_by?: 'code' | 'raters' | 'human';
  measurable_by_agent?: boolean;
  check?: unknown;
}): 'code' | 'raters' | 'human' {
  if (dim.measured_by) return dim.measured_by;
  if (dim.measurable_by_agent === false) return 'human';
  return dim.check ? 'code' : 'raters';
}

export const scorecardFileSchema = z
  .object({
    scorecard: z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      version: z.union([z.string(), z.number()]).transform(String),
      judges: z.string().refine((v) => /^(D1|D3)\b/.test(v.trim()), {
        message: 'judges must start with D1 (schema) or D3 (output)',
      }),
      step: z.string().optional(),
      frozen: z.boolean().default(false),
      approval: z.string().optional(),
      thresholds: z
        .object({ accept: z.number().min(0).max(100), refine: z.number().min(0).max(100) })
        .default({ accept: 90, refine: 75 }),
      artifact: z.object({
        sheets: z.array(sheetSchema).min(1),
        context_sheets: z.array(sheetSchema).default([]),
      }),
      dimensions: z.array(dimensionSchema).min(1),
    }),
  })
  .superRefine(({ scorecard }, ctx) => {
    const seen = new Set<string>();
    for (const dim of scorecard.dimensions) {
      if (seen.has(dim.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate dimension id ${dim.id}` });
      }
      seen.add(dim.id);
    }
    if (scorecard.thresholds.refine >= scorecard.thresholds.accept) {
      ctx.addIssue({ code: 'custom', message: 'thresholds.refine must be below thresholds.accept' });
    }
  });

export type ScorecardFile = z.infer<typeof scorecardFileSchema>;

export function toScorecard(file: ScorecardFile): Scorecard {
  const sc = file.scorecard;
  const sheet = (s: { name: string; header_row: number; columns?: string[] }) => ({
    name: s.name,
    headerRow: s.header_row,
    ...(s.columns ? { columns: s.columns } : {}),
  });
  return {
    id: sc.id,
    name: sc.name ?? sc.id,
    version: sc.version,
    gate: /^D3/.test(sc.judges.trim()) ? 'D3' : 'D1',
    step: sc.step,
    frozen: sc.frozen,
    approval: sc.approval,
    thresholds: sc.thresholds,
    artifact: { sheets: sc.artifact.sheets.map(sheet), context: sc.artifact.context_sheets.map(sheet) },
    dimensions: sc.dimensions.map((d) => ({
      id: d.id,
      name: d.name,
      weight: d.weight,
      critical: d.critical,
      measuredBy: resolveMeasuredBy(d),
      description: d.description,
      measure: d.measure,
      anchors: d.anchors
        ? Object.fromEntries(Object.entries(d.anchors).map(([k, v]) => [Number(k), v]))
        : undefined,
      check: d.check
        ? {
            id: d.check.id,
            params: d.check.params,
            bands: [...d.check.bands].sort((a, b) => b.min - a.min),
            fix: d.check.fix,
          }
        : undefined,
      needs: d.needs,
      returnTo: d.return_to,
      reads: d.reads,
    })),
  };
}
