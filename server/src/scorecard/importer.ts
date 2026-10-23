import YAML from 'yaml';
import { scorecardFileSchema, type ScorecardFile } from '@ddd/shared';
import { callJsonModel, extractJson, type CallSettings } from '../agent/callModel.js';
import { serializeSheet } from '../excel/serialize.js';
import { WorkbookModel } from '../excel/workbook.js';
import { isPdf } from '../excel/pdfReader.js';
import type { ModelsConfig } from '../config.js';
import type { ProviderFactory } from '../llm/registry.js';
import type { LlmProvider } from '../llm/types.js';
import { UserError } from '../util/errors.js';
import { truncate } from '../util/text.js';
import { MAX_PAGES_PER_QUESTION, MAX_PAGES_ROOMY, checkDraft, draftToYaml, listQuestions, summarise, type Draft } from './importDraft.js';
import { buildImportUser, importSystem } from './importPrompt.js';

export { MAX_PAGES_PER_QUESTION, MAX_PAGES_ROOMY, checkDraft } from './importDraft.js';
export { IMPORT_MARKER } from './importPrompt.js';

/**
 * Turns a scorecard written in any layout into a DRAFT in this app's format. A model reads it and proposes the
 * draft; code then checks the draft, fixes what it can and says what it changed. The result is never frozen:
 * a person has to compare it with the original and approve it before anything is scored against it.
 */

const MAX_SOURCE_CHARS = 60_000;
const MAX_SHEET_CHARS = 24_000;
const MAX_OUTLINE_PAGES = 400;

export interface ImportInput {
  source: { name: string; bytes: Buffer };
  /** The file the scorecard will judge. Optional, but it lets the draft name real sheets or pages. */
  document?: { name: string; bytes: Buffer };
}

export interface ImportedQuestion {
  id: string;
  name: string;
  weight: number;
  critical: boolean;
  by: 'examiners' | 'person' | 'code';
  reads: string[];
  /** For a count made by code: what it counts, in words. */
  how?: string;
}

export interface ImportResult {
  draft: ScorecardFile;
  /** One row per question, for the review table. */
  questions: ImportedQuestion[];
  yaml: string;
  /** Things the model was not sure about, for the reviewer to check first. */
  uncertain: string[];
  /** What code changed or dropped after the model answered. */
  adjustments: string[];
  summary: { dimensions: number; byExaminers: number; byCode: number; byPerson: number; critical: number; weightTotal: number };
  /** What the model was shown, so the reviewer can compare. */
  sourceText: string;
  documentOutline: string | null;
  model: { id: string; provider: string; model: string };
  inputTokens: number | null;
  outputTokens: number | null;
}

const isBook = (name: string, bytes: Buffer) => /\.xlsx$/i.test(name) || isPdf(bytes);

/** The text of the scorecard as the model sees it. */
export async function readSourceText(source: { name: string; bytes: Buffer }): Promise<string> {
  if (!isBook(source.name, source.bytes)) return truncate(source.bytes.toString('utf8'), MAX_SOURCE_CHARS);
  const wb = await WorkbookModel.load(source.bytes);
  const parts: string[] = [];
  let used = 0;
  for (const name of wb.sheetNames()) {
    let text = serializeSheet(wb, name);
    if (text.length > MAX_SHEET_CHARS) text = `${text.slice(0, MAX_SHEET_CHARS)}\n[sheet cut here: too long to show in full]`;
    if (used + text.length > MAX_SOURCE_CHARS) {
      parts.push(`## Sheet: ${name}\n[left out: the file is too long to show in full]`);
      continue;
    }
    parts.push(text);
    used += text.length;
  }
  return parts.join('\n\n');
}

export interface DocumentOutline {
  text: string;
  kind: 'pdf' | 'excel';
  names: string[];
  pages: number;
}

/** A short map of the document the scorecard will judge: pages with their first line, or sheets with their headers. */
export async function outlineDocument(document: { name: string; bytes: Buffer }): Promise<DocumentOutline> {
  const wb = await WorkbookModel.load(document.bytes);
  const names = wb.sheetNames();
  if (isPdf(document.bytes)) {
    const lines = names.slice(0, MAX_OUTLINE_PAGES).map((name) => `${name}: ${truncate(wb.cellText(name, 'A1') ?? '', 90)}`);
    return { kind: 'pdf', names, pages: names.length, text: `PDF with ${names.length} pages. Sheets are named "Page 1" to "Page ${names.length}". First line of each page:\n${lines.join('\n')}` };
  }
  const lines = names.map((name) => {
    const headers = wb.cells(name).filter(([row]) => row === 1).slice(0, 12).map(([, , text]) => truncate(text, 30));
    return `${name} (${wb.dimensions(name)?.rows ?? 0} rows): ${headers.join(' | ')}`;
  });
  return { kind: 'excel', names, pages: 0, text: `Excel workbook. Sheets and their first-row headers:\n${lines.join('\n')}` };
}

export interface ImportDeps {
  /** Pages one question may read from a PDF. Defaults to the small-model limit. */
  maxPages?: number;
  provider: LlmProvider;
  model: { id: string; provider: string; model: string };
  settings: CallSettings;
}

export async function importScorecard(input: ImportInput, deps: ImportDeps): Promise<ImportResult> {
  const sourceText = await readSourceText(input.source);
  if (sourceText.trim() === '') throw new UserError('That file has no readable text to import.');
  const outline = input.document ? await outlineDocument(input.document) : null;

  const call = await callJsonModel<Draft>({
    provider: deps.provider,
    model: deps.model.model,
    system: importSystem(deps.maxPages ?? MAX_PAGES_PER_QUESTION),
    user: buildImportUser(input.source.name, sourceText, outline),
    settings: { temperature: 0, maxOutputTokens: Math.max(deps.settings.maxOutputTokens, 16_000) },
    parse: (raw) => checkDraft(extractJson(raw), input.source.name, outline, deps.maxPages),
  });
  if (!call.ok || !call.value) {
    throw new UserError(`The model could not turn this into a usable scorecard. ${call.error ?? ''}`.trim(), 502);
  }
  const { file, uncertain, adjustments } = call.value;
  const summary = summarise(file);
  if (summary.weightTotal !== 100) {
    adjustments.push(`The weights add up to ${summary.weightTotal}, not 100. Scores are worked out as a share of the total, so this still works, but check it matches the original.`);
  }
  return {
    draft: file,
    questions: listQuestions(file),
    yaml: draftToYaml(file, input.source.name),
    uncertain,
    adjustments,
    summary,
    sourceText,
    documentOutline: outline?.text ?? null,
    model: deps.model,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

/**
 * The models that may read a scorecard: the first rater with no prompt limit (the most room), else the consolidator, then its
 * backups (a backup with no key is skipped). The page cap follows the roster: tight free-tier limits mean fewer pages per question.
 */
export function importCandidates(models: ModelsConfig, providers: ProviderFactory): ImportDeps[] {
  const chosen = models.raters.find((r) => !r.maxInputTokens) ?? models.consolidator;
  const tight = models.raters.some((r) => r.maxInputTokens !== undefined && r.maxInputTokens <= 20_000);
  const maxPages = tight ? MAX_PAGES_PER_QUESTION : MAX_PAGES_ROOMY;
  const settings = { temperature: models.settings.temperature, maxOutputTokens: models.settings.maxOutputTokens };
  return [{ provider: chosen.provider, model: chosen.model }, ...(chosen.fallbacks ?? [])].flatMap((c) => {
    try {
      return [{ maxPages, settings, provider: providers(c.provider), model: { id: chosen.id, provider: c.provider, model: c.model } }];
    } catch {
      return [];
    }
  });
}

/** Tries each model in turn (the chosen one, then its backups) and keeps the first draft that works. */
export async function importWithFallbacks(input: ImportInput, candidates: ImportDeps[]): Promise<ImportResult> {
  let last: unknown;
  for (const candidate of candidates) {
    try {
      return await importScorecard(input, candidate);
    } catch (error) {
      // A bad file is the same for every model; only a model-side failure is worth trying the next one for.
      if (!(error instanceof UserError) || error.status !== 502) throw error;
      last = error;
    }
  }
  throw last;
}

/** Re-checks an edited draft and, when a name is given, approves it: frozen, with who approved it and when. */
export function approveDraft(yamlText: string, approvedBy?: string, now = new Date()): { yaml: string; summary: ImportResult['summary']; frozen: boolean } {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (error) {
    throw new UserError(`The scorecard is not valid YAML: ${(error as Error).message}`);
  }
  const parsed = scorecardFileSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 12).map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new UserError(`The scorecard has problems:\n${lines.join('\n')}`);
  }
  const file = parsed.data;
  if (approvedBy?.trim()) {
    file.scorecard.frozen = true;
    file.scorecard.approval = `Approved by ${approvedBy.trim()} on ${now.toISOString().slice(0, 10)} (imported draft, checked against the original)`;
  }
  return { yaml: YAML.stringify(file, { lineWidth: 110 }), summary: summarise(file), frozen: file.scorecard.frozen };
}
