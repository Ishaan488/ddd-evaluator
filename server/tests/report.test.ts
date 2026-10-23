import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { assembleReport } from '../src/report/assemble.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderXlsx } from '../src/report/xlsx.js';
import { renderPdf } from '../src/report/pdf.js';
import { improvementPlan } from '../src/report/improvements.js';
import { TALENTRA_XLSX, runEvaluation } from './helpers.js';

describe('the eight-section report (PDF page 11)', () => {
  it('has all eight sections, in order, in the workbook and the Markdown', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const report = assembleReport(run.core, [], null);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await renderXlsx(report)) as unknown as ExcelJS.Buffer);
    expect(book.worksheets.map((s) => s.name.replace(/^\d /, ''))).toEqual([
      'What to improve', 'Header', 'Verdict', 'Dimension scores', 'Strengths', 'Gaps and findings', 'Rater agreement', 'Not measurable', 'Path to green',
    ]);

    const header = book.getWorksheet('1 Header')!;
    const values = new Map<string, unknown>();
    header.eachRow((row) => values.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(values.get('Artifact hash')).toBe(report.header.artifactHash);
    expect(values.get('Rater A')).toMatch(/mock \/ mock-mid/);

    const scores = book.getWorksheet('3 Dimension scores')!;
    expect(scores.rowCount).toBe(report.dimensions.length + 1);
    const findings = book.getWorksheet('5 Gaps and findings')!;
    expect(findings.rowCount).toBe(report.findings.length + 1);

    const markdown = renderMarkdown(report);
    const order = ['## 1. Header', '## 2. Verdict', '## 3. Dimension scores', '## 4. Strengths', '## 5. Gaps and findings', '## 6. Rater agreement', '## 7. Not measurable here', '## 8. Path to green'];
    const positions = order.map((h) => markdown.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('lists every finding and every outstanding person-only item in the improvement plan, and renders a PDF', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const report = assembleReport(run.core, [], null);
    const plan = improvementPlan(report);
    expect(plan.filter((r) => ['HIGH', 'MEDIUM', 'LOW'].includes(r.severity))).toHaveLength(report.findings.length);
    expect(plan.filter((r) => r.severity === 'PERSON')).toHaveLength(report.notMeasurable.filter((n) => !n.evidence).length);
    expect(plan.map((r) => r.priority)).toEqual(plan.map((_, i) => i + 1));
    const pdf = await renderPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it('shows the extra instructions in both formats when there are some, and not otherwise', async () => {
    const { evaluate } = await import('../src/agent/index.js');
    const { createProviderFactory } = await import('../src/llm/registry.js');
    const { mockModels, loadTalentraScorecard } = await import('./helpers.js');
    const models = mockModels();
    const parsed = await loadTalentraScorecard();
    const out = await evaluate({ runId: 'r', projectName: 'p', iteration: 1, workbookPath: TALENTRA_XLSX, artifactName: 'a.xlsx', scorecard: parsed.scorecard, scorecardHash: parsed.hash, sources: '', instructions: 'Be strict about definitions.', models, providers: createProviderFactory(models, { mockDelayMs: 0 }), env: {} });
    const report = assembleReport(out.core, [], null);
    expect(renderMarkdown(report)).toMatch(/\| Extra instructions \| Be strict about definitions\. \(`[0-9a-f]{12}`\) \|/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await renderXlsx(report)) as unknown as ExcelJS.Buffer);
    const rows = new Map<string, unknown>();
    book.getWorksheet('1 Header')!.eachRow((row) => rows.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(rows.get('Extra instructions')).toBe('Be strict about definitions.');
    const plain = assembleReport((await runEvaluation({ workbook: TALENTRA_XLSX })).core, [], null);
    expect(renderMarkdown(plain)).not.toMatch(/Extra instructions/);
  });

  it('shows each finding with its id, severity, location, fix and where to return to', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const md = renderMarkdown(assembleReport(run.core, [], null));
    expect(md).toMatch(/\| F-01 \| MEDIUM \| C06 \| Tree!L121 \|.*\| Define \|/);
  });

  it('is rebuilt from the stored evaluation plus people\'s input, and the evaluation itself never changes', async () => {
    const run = await runEvaluation({ workbook: TALENTRA_XLSX });
    const snapshot = JSON.stringify(run.core);
    const first = assembleReport(run.core, [], null);
    const second = assembleReport(
      run.core,
      [{ id: 'e', runId: 'r', dimensionId: 'H01', score: 5, note: 'ok', by: 'Mentor', createdAt: '2026-10-22T10:00:00Z' }],
      { id: 'o', runId: 'r', decision: 'red', reason: 'because', by: 'Lead', createdAt: '2026-10-22T11:00:00Z' },
    );
    expect(JSON.stringify(run.core)).toBe(snapshot);
    expect(first.verdict.override).toBeNull();
    expect(second.verdict).toMatchObject({ decision: 'red', agentDecision: expect.any(String) });
    expect(second.notMeasurable[0]!.evidence!.by).toBe('Mentor');
    expect(second.dimensions.find((d) => d.id === 'H01')).toMatchObject({ consolidated: 5, status: 'scored' });
  });
});
