import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { HumanEvidence, Scorecard } from '@ddd/shared';
import { parseScorecard } from '../src/scorecard/parse.js';
import { evaluate } from '../src/agent/orchestrator.js';
import { assembleReport } from '../src/report/assemble.js';
import type { LlmProvider } from '../src/llm/types.js';
import { sha256 } from '../src/util/hash.js';
import {
  CLEAN_SCORECARD_YAML, CLEAN_TREE, TALENTRA_XLSX, loadTalentraScorecard, makeWorkbook, mockModels, patchCells, runEvaluation, writeTemp,
} from './helpers.js';

const signOff = (score = 5): HumanEvidence => ({
  id: 'e', runId: 'r', dimensionId: 'H01', score, note: 'Interview passed', by: 'Mentor', createdAt: '2026-10-22T10:00:00Z',
});

const verdictOf = (run: Awaited<ReturnType<typeof runEvaluation>>, evidence: HumanEvidence[] = []) =>
  assembleReport(run.core, evidence, null).verdict;

describe('Level 1 evaluation of the Talentra workbook', () => {
  it('finds the real defects with exact cells, and is never green while the author interview is outstanding', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const report = assembleReport(run.core, [], null);

    expect(report.verdict.decision).toBe('amber');
    expect(report.verdict.reasons.join(' ')).toMatch(/H01/);
    expect(report.notMeasurable.map((n) => n.dimensionId)).toEqual(['H01']);

    const c06 = report.findings.find((f) => f.dimensionId === 'C06')!;
    expect(c06.location).toEqual({ sheet: 'Tree', cell: 'L121' });
    expect(c06.title).toMatch(/44 of 45/);
    const c07 = report.findings.find((f) => f.dimensionId === 'C07')!;
    expect(c07.location).toEqual({ sheet: 'Allowed values', cell: 'A156' });
    expect(report.dimensions.find((d) => d.id === 'C02')!.consolidated).toBe(5);
  });

  it('stays amber with middling raters even after the interview, because the score is under 90', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const v = verdictOf(run, [signOff(5)]);
    expect(v.weightedScore).toBeLessThan(90);
    expect(v.decision).toBe('amber');
    expect(v.reasons.join(' ')).toMatch(/below 90/);
  });

  it('a failed interview keeps it amber even when the score is high', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-lenient', 'mock-lenient', 'mock-lenient']) });
    const v = verdictOf(run, [signOff(2)]);
    expect(v.weightedScore).toBeGreaterThan(90);
    expect(v.decision).toBe('amber');
  });

  it('writes a header that proves what was evaluated, and never touches the workbook', async () => {
    const before = sha256(await readFile(TALENTRA_XLSX));
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    expect(run.core.header.artifactHash).toBe(before);
    expect(sha256(await readFile(TALENTRA_XLSX))).toBe(before);
    expect(run.core.header.raters.map((r) => r.model)).toEqual(['mock-mid', 'mock-lenient', 'mock-strict']);
    expect(run.core.header.scorecardApproval).toMatch(/pending mentor approval/);
    expect(run.runLog.promptVersion).toBe('l1-prompts/1.0');
    expect(run.runLog.participants).toHaveLength(4);
  });

  it('is deterministic: the same inputs give the same scores and verdict', async () => {
    const a = await runEvaluation({ workbook: TALENTRA_XLSX });
    const b = await runEvaluation({ workbook: TALENTRA_XLSX });
    expect(a.core.dimensions).toEqual(b.core.dimensions);
    expect(verdictOf(a)).toEqual(verdictOf(b));
  });

  it('keeps raters blind: identical prompts, no scores, no other rater, only the rater dimensions', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const raters = run.calls.filter((c) => c.role === 'rater');
    expect(new Set(raters.map((c) => c.promptHash)).size).toBe(1);
    const prompt = raters[0]!.prompt;
    expect(prompt).not.toMatch(/mock-|rater_results|self-?assess/i);
    const card = JSON.parse(/<scorecard>\n([\s\S]*?)\n<\/scorecard>/.exec(prompt)![1]!);
    expect(card.dimensions.map((d: { id: string }) => d.id)).toEqual(['J01', 'J02', 'J03', 'J04', 'J05', 'J06']);
    expect(prompt).toContain('## Sheet: Tree');
    expect(prompt).toContain('## Sheet: Playbook map');
    const consolidator = run.calls.find((c) => c.role === 'consolidator')!;
    expect(consolidator.prompt).toContain('<rater_results>');
  });
});

describe('planted defects must never come out green (false greens are the most expensive error)', () => {
  const lenient = mockModels(['mock-lenient', 'mock-lenient', 'mock-lenient']);

  async function planted(edits: Record<string, string | number | null>, sheet = 'Tree') {
    const source = await readFile(TALENTRA_XLSX);
    return runEvaluation({ workbook: await patchCells(source, sheet, edits), models: lenient });
  }

  it('baseline: the unmodified workbook with perfect raters and a passed interview is green', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: lenient });
    expect(verdictOf(run, [signOff()]).decision).toBe('green');
  });

  it('a tree that goes four levels deep', async () => {
    const run = await planted({ E10: 4 });
    const v = verdictOf(run, [signOff()]);
    expect(v.decision).toBe('amber');
    expect(v.criticalGates.find((g) => g.dimensionId === 'C01')).toMatchObject({ status: 'failed' });
    expect(run.core.findings.find((f) => f.dimensionId === 'C01')).toMatchObject({ severity: 'HIGH', location: { sheet: 'Tree', cell: 'E10' } });
  });

  it('a duplicated path id', async () => {
    const run = await planted({ D10: '1.1.1' });
    expect(verdictOf(run, [signOff()]).decision).toBe('amber');
    expect(run.core.findings.some((f) => f.dimensionId === 'C05' && f.severity === 'HIGH')).toBe(true);
  });

  it('ten missing definitions', async () => {
    const blank = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${20 + i}`, null]));
    const run = await planted(blank);
    expect(verdictOf(run, [signOff()]).decision).toBe('amber');
    const finding = run.core.findings.find((f) => f.dimensionId === 'C02')!;
    expect(finding.location!.sheet).toBe('Tree');
    expect(finding.location!.cell).toMatch(/^H\d+$/);
    expect(finding.detail).toMatch(/Tree!H20/);
  });

  it('a choice field that points at no list is reported at that cell, and the score drops', async () => {
    const run = await planted({ L6: 'unbounded' });
    expect(run.core.findings.some((f) => f.dimensionId === 'C09' && f.location?.cell === 'L6')).toBe(true);
    const base = await runEvaluation({ workbook: TALENTRA_XLSX, models: lenient });
    expect(verdictOf(run, [signOff()]).weightedScore).toBeLessThan(verdictOf(base, [signOff()]).weightedScore);
  });

  it('a list reference with a rule glued onto the name is already in the real file, and is found', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: lenient });
    expect(run.core.findings.find((f) => f.dimensionId === 'C06')!.detail).toContain('Tree!L121');
  });
});

describe('high-risk findings from the raters', () => {
  it('stop a perfect-scoring evaluation from turning green until they are fixed', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-alarmist', 'mock-alarmist', 'mock-alarmist']) });
    const report = assembleReport(run.core, [signOff(5)], null);
    expect(report.verdict.weightedScore).toBeGreaterThan(95);
    expect(report.findings.some((f) => f.severity === 'HIGH' && f.source === 'raters')).toBe(true);
    expect(report.verdict.decision).toBe('amber');
    expect(report.verdict.blockingFindings.length).toBeGreaterThan(0);
    expect(report.pathToGreen.blockingFindingIds).toEqual(report.verdict.blockingFindings);
  });
});

describe('when models misbehave', () => {
  it('leaves out a rater that never returns JSON, after one repair attempt, and says so', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-mid', 'mock-garbage', 'mock-strict']) });
    const garbage = run.calls.find((c) => c.model.model === 'mock-garbage')!;
    expect(garbage).toMatchObject({ status: 'failed', attempts: 2 });
    expect(run.core.notes.join(' ')).toMatch(/Rater B .* failed and was left out/);
    expect(run.core.dimensions.find((d) => d.id === 'J01')).toMatchObject({ raterScores: { A: 4, B: null, C: 3 }, consolidated: 4 });
  });

  it('discards scores that cite no evidence, and does not let them count', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-mid', 'mock-nocite', 'mock-strict']) });
    const rater = run.calls.find((c) => c.model.model === 'mock-nocite')!;
    expect(rater.discarded).toBe(6);
    expect(rater.discardedDetail[0]!.reason).toMatch(/no supported evidence/);
    expect(run.core.dimensions.find((d) => d.id === 'J02')!.raterScores).toEqual({ A: 4, B: null, C: 3 });
    expect(run.core.notes.join(' ')).toMatch(/6 claim\(s\) discarded/);
  });

  it('fails loudly, not with a misleading red, when every rater fails', async () => {
    await expect(runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-down', 'mock-garbage', 'mock-down']) })).rejects.toThrow(
      /All three raters failed/,
    );
  });

  it('keeps the lower score and flags it for a person when a big disagreement cannot be resolved', async () => {
    const run = await runEvaluation({
      workbook: TALENTRA_XLSX,
      models: mockModels(['mock-low', 'mock-lenient', 'mock-strict'], 'mock-consolidator-unresolved'),
    });
    const j01 = run.core.dimensions.find((d) => d.id === 'J01')!;
    expect(j01).toMatchObject({ consolidated: 1, spread: 4, resolution: 'lower_stands', flagged: true });
    expect(assembleReport(run.core, [], null).agreement.find((a) => a.dimensionId === 'J01')!.flagged).toBe(true);
  });

  it('accepts the consolidator\'s score for a big disagreement only when it cites real evidence', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-low', 'mock-lenient', 'mock-strict']) });
    const j01 = run.core.dimensions.find((d) => d.id === 'J01')!;
    expect(j01).toMatchObject({ consolidated: 3, resolution: 'claims_checked', flagged: false });
    expect(j01.evidence.length).toBeGreaterThan(0);
  });

  it('refuses a consolidator score outside the range of the raters', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-low', 'mock-low', 'mock-strict'], 'mock-consolidator-greedy') });
    // raters scored 1, 1, 3; the consolidator answered 5, which no rater supports
    expect(run.core.dimensions.find((d) => d.id === 'J01')).toMatchObject({ consolidated: 1, resolution: 'lower_stands', flagged: true });
  });

  it('falls back to the lower score everywhere when the consolidator itself fails', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-mid', 'mock-lenient', 'mock-strict'], 'mock-consolidator-down') });
    expect(run.core.consolidatorFailed).toBe(true);
    expect(run.core.dimensions.find((d) => d.id === 'J01')).toMatchObject({ consolidated: 3, flagged: true });
    expect(run.core.notes.join(' ')).toMatch(/consolidator failed/);
    expect(run.core.findings.some((f) => f.source === 'raters')).toBe(true);
  });

  it('treats a dimension every rater declines as not measurable, which needs a person', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-abstain', 'mock-abstain', 'mock-abstain']) });
    const report = assembleReport(run.core, [], null);
    expect(run.core.dimensions.find((d) => d.id === 'J01')!.status).toBe('not_measurable');
    expect(report.notMeasurable.map((n) => n.dimensionId)).toContain('J01');
    expect(report.verdict.decision).not.toBe('green');
  });

  it('flags a dimension scored by only one rater', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models: mockModels(['mock-mid', 'mock-garbage', 'mock-down']) });
    expect(run.core.dimensions.find((d) => d.id === 'J01')).toMatchObject({ consolidated: 4, resolution: 'single_rater', flagged: true });
  });
});

describe('guardrails (PDF page 13)', () => {
  const unfrozen = async (): Promise<{ scorecard: Scorecard; hash: string }> => {
    const { scorecard, hash } = await loadTalentraScorecard();
    return { scorecard: { ...scorecard, frozen: false }, hash };
  };

  it('Freeze: refuses an unfrozen scorecard', async () => {
    await expect(runEvaluation({ workbook: TALENTRA_XLSX, scorecard: await unfrozen() })).rejects.toThrow(/not frozen/);
  });

  it('Freeze: aborts if the workbook changes while it is being evaluated', async () => {
    const path = await writeTemp('x.xlsx', await makeWorkbook({ Tree: CLEAN_TREE }));
    const parsed = parseScorecard(CLEAN_SCORECARD_YAML);
    const models = mockModels();
    const tamper: LlmProvider = {
      name: 'mock',
      async complete() {
        await writeFile(path, 'tampered');
        return { text: '{}', inputTokens: 0, outputTokens: 0 };
      },
    };
    await expect(
      evaluate({
        runId: 'r', projectName: 'p', iteration: 1, workbookPath: path, artifactName: 'x.xlsx', scorecard: parsed.scorecard,
        scorecardHash: parsed.hash, sources: '', models, providers: () => tamper, env: {},
      }),
    ).rejects.toThrow(/changed while it was being evaluated|All three raters failed/);
  });

  it('Independence: refuses two raters from the same model family', async () => {
    const models = mockModels();
    models.raters[1]!.family = models.raters[0]!.family;
    await expect(runEvaluation({ workbook: TALENTRA_XLSX, models })).rejects.toThrow(/three different model families/);
  });

  it('Confidentiality: refuses a model that is not on the approved list', async () => {
    const models = mockModels();
    models.approved = ['mock:mock-mid'];
    await expect(runEvaluation({ workbook: TALENTRA_XLSX, models })).rejects.toThrow(/not on the approved list/);
  });

  it('Confidentiality: refuses a live provider that has no API key', async () => {
    const models = mockModels();
    models.providers.groq = { type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' };
    models.approved.push('groq:*');
    models.raters[0] = { id: 'A', provider: 'groq', model: 'llama', family: 'meta' };
    await expect(runEvaluation({ workbook: TALENTRA_XLSX, models })).rejects.toThrow(/no API key\. Set GROQ_API_KEY/);
  });

  it('names the problem when the scorecard asks for a sheet the workbook does not have', async () => {
    const wb = await makeWorkbook({ Other: [['a']] });
    await expect(runEvaluation({ workbook: wb })).rejects.toThrow(/Sheet "Tree" named by the scorecard was not found.*Other/);
  });

  it('Evidence: every finding and strength the report shows points at a real cell', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const { WorkbookModel } = await import('../src/excel/workbook.js');
    const wb = await WorkbookModel.load(TALENTRA_XLSX);
    const cited = [...run.core.findings.map((f) => f.location), ...run.core.strengths.map((s) => s.location)];
    expect(cited.length).toBeGreaterThan(5);
    for (const loc of cited) expect(wb.inBounds(loc!.sheet, loc!.cell)).toBe(true);
    for (const dim of run.core.dimensions) for (const e of dim.evidence) expect(wb.inBounds(e.sheet, e.cell)).toBe(true);
  });
});

describe('a scorecard with nothing for the raters', () => {
  it('runs code checks only and does not call a model', async () => {
    const yaml = CLEAN_SCORECARD_YAML.replace(/    - id: J01[\s\S]*?(?=    - id: H01)/, '');
    const run = await runEvaluation({ workbook: await makeWorkbook({ Tree: CLEAN_TREE }), scorecard: parseScorecard(yaml) });
    expect(run.calls).toHaveLength(0);
    expect(run.core.notes.join(' ')).toMatch(/no rater dimensions/);
    expect(verdictOf(run, [{ ...signOff(), dimensionId: 'H01' }]).decision).toBe('green');
  });
});

describe('the output gate (D3 against D4)', () => {
  it('evaluates the NFR register against the output scorecard and finds the open items', async () => {
    const { readFile: read } = await import('node:fs/promises');
    const parsed = parseScorecard(await read(new URL('../../samples/talentra/talentra-step04-d4.yaml', import.meta.url), 'utf8'));
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, scorecard: parsed });
    expect(run.core.header.gate).toBe('D3');
    const report = assembleReport(run.core, [], null);
    expect(report.dimensions.filter((d) => d.measuredBy === 'code').every((d) => d.status === 'scored')).toBe(true);
    expect(report.notMeasurable.map((n) => n.dimensionId)).toEqual(['H01']);
    expect(report.verdict.decision).toBe('amber');
  });
});
