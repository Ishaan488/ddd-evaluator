import ExcelJS from 'exceljs';
import type { Decision, Report } from '@ddd/shared';
import { improvementPlan } from './improvements.js';

const SEV_FILL: Record<string, string> = { HIGH: 'FFF8D7D5', MEDIUM: 'FFFBEBCB', LOW: 'FFD9E8F7', SCORE: 'FFEDEDEF', PERSON: 'FFE6DFF5' };
const FILL: Record<Decision, string> = { green: 'FF1F8A4C', amber: 'FFB7791F', red: 'FFB4322F' };

function sheet(workbook: ExcelJS.Workbook, name: string, columns: Array<{ header: string; width: number }>) {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B1B1F' } };
  ws.eachRow(() => undefined);
  return ws;
}

const where = (loc: { sheet: string; cell: string } | null) => (loc ? `${loc.sheet}!${loc.cell}` : '');

/** The eight-section report as a workbook, one sheet per section (PDF page 11). */
export async function renderXlsx(report: Report): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DDD Evaluator';
  const { header, verdict } = report;
  const raterIds = header.raters.map((r) => r.id);

  const plan = sheet(workbook, 'What to improve', [
    { header: 'Priority', width: 9 }, { header: 'Type', width: 12 }, { header: 'Dimension', width: 38 }, { header: 'Where', width: 22 },
    { header: 'Problem', width: 55 }, { header: 'What to do', width: 65 }, { header: 'Go back to', width: 12 }, { header: 'Score gain', width: 11 }, { header: 'Done', width: 8 },
  ]);
  for (const row of improvementPlan(report)) {
    const added = plan.addRow([row.priority, row.severity === 'SCORE' ? 'LOW SCORE' : row.severity === 'PERSON' ? 'NEEDS A PERSON' : row.severity, row.dimension, row.where, row.problem, row.action, row.returnTo, row.gain ?? '', '']);
    added.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEV_FILL[row.severity] ?? 'FFFFFFFF' } };
    added.getCell(2).font = { bold: true };
  }
  plan.autoFilter = { from: 'A1', to: 'I1' };

  const h = sheet(workbook, '1 Header', [{ header: 'Item', width: 26 }, { header: 'Value', width: 90 }]);
  h.addRows([
    ['Project', header.projectName],
    ['Iteration', header.iteration],
    ['Artifact', header.artifactName],
    ['Artifact hash', header.artifactHash],
    ['Scorecard', `${header.scorecardName} v${header.scorecardVersion}`],
    ['Scorecard hash', header.scorecardHash],
    ['Scorecard approval', header.scorecardApproval ?? 'not stated'],
    ['Gate', header.gate === 'D1' ? 'D1 schema design' : 'D3 output document'],
    ['Step', header.step ?? ''],
    ...header.raters.map((r) => [`Rater ${r.id}`, `${r.provider} / ${r.model} (${r.family})`]),
    ['Consolidator', `${header.consolidator.provider} / ${header.consolidator.model} (${header.consolidator.family})`],
    ['Prompt version', header.promptVersion],
    ...(header.instructions ? [['Extra instructions', header.instructions], ['Instructions hash', header.instructionsHash ?? '']] : []),
    ['Run id', header.runId],
    ['Started', header.startedAt],
    ['Finished', header.finishedAt],
  ]);

  const v = sheet(workbook, '2 Verdict', [{ header: 'Item', width: 28 }, { header: 'Value', width: 28 }, { header: 'Detail', width: 80 }]);
  const decisionRow = v.addRow(['Decision', verdict.decision.toUpperCase(), verdict.reasons.join(' ')]);
  decisionRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[verdict.decision] } };
  decisionRow.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  v.addRow(['Weighted score', verdict.weightedScore, `Accept ≥ ${verdict.thresholds.accept}, refine ≥ ${verdict.thresholds.refine}`]);
  v.addRow(['Agent verdict', verdict.agentDecision.toUpperCase(), verdict.override ? `Overridden by ${verdict.override.by}: ${verdict.override.reason}` : '']);
  v.addRow([]);
  v.addRow(['Critical gate', 'Score', 'Result']).font = { bold: true };
  for (const g of verdict.criticalGates) v.addRow([`${g.dimensionId} ${g.name}`, g.score ?? '', g.status]);

  const d = sheet(workbook, '3 Dimension scores', [
    { header: 'ID', width: 8 }, { header: 'Dimension', width: 42 }, { header: 'Weight', width: 9 }, { header: 'Critical', width: 9 },
    { header: 'Measured by', width: 13 }, ...raterIds.map((id) => ({ header: `Rater ${id}`, width: 10 })),
    { header: 'Score', width: 8 }, { header: 'Spread', width: 8 }, { header: 'Status', width: 15 }, { header: 'Rationale', width: 80 },
  ]);
  for (const dim of report.dimensions) {
    const added = d.addRow([dim.id, dim.name, dim.weight, dim.critical ? 'yes' : '', dim.measuredBy, ...raterIds.map((id) => dim.raterScores[id] ?? ''), dim.consolidated ?? '', dim.spread ?? '', dim.status, dim.rationale]);
    if (dim.consolidated !== null) {
      const cellRef = added.getCell(6 + raterIds.length);
      cellRef.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dim.consolidated >= 4 ? 'FFD6EFDF' : dim.consolidated >= 3 ? 'FFFBEBCB' : 'FFF8D7D5' } };
      cellRef.font = { bold: true };
    }
  }

  const s = sheet(workbook, '4 Strengths', [{ header: 'Dimension', width: 12 }, { header: 'Strength', width: 90 }, { header: 'Where', width: 28 }]);
  for (const item of report.strengths) s.addRow([item.dimensionId, item.text, where(item.location)]);

  const f = sheet(workbook, '5 Gaps and findings', [
    { header: 'ID', width: 8 }, { header: 'Severity', width: 11 }, { header: 'Dimension', width: 11 }, { header: 'Where', width: 28 },
    { header: 'Finding', width: 60 }, { header: 'Detail', width: 60 }, { header: 'Recommended fix', width: 60 }, { header: 'Return to', width: 12 }, { header: 'Reported by', width: 14 },
  ]);
  for (const item of report.findings) {
    f.addRow([item.id, item.severity, item.dimensionId, where(item.location), item.title, item.detail, item.fix, item.returnTo, item.reportedBy.join(', ')]);
  }

  const a = sheet(workbook, '6 Rater agreement', [
    { header: 'Dimension', width: 40 }, ...raterIds.map((id) => ({ header: `Rater ${id}`, width: 10 })),
    { header: 'Spread', width: 9 }, { header: 'Resolution', width: 16 }, { header: 'Flagged for a person', width: 20 }, { header: 'Note', width: 80 },
  ]);
  for (const row of report.agreement) {
    a.addRow([`${row.dimensionId} ${row.name}`, ...raterIds.map((id) => row.scores[id] ?? ''), row.spread ?? '', row.resolution, row.flagged ? 'yes' : '', row.note]);
  }

  const n = sheet(workbook, '7 Not measurable', [
    { header: 'Dimension', width: 40 }, { header: 'Critical', width: 9 }, { header: 'Why', width: 50 }, { header: 'What is needed', width: 70 }, { header: 'Status', width: 60 },
  ]);
  for (const item of report.notMeasurable) {
    n.addRow([`${item.dimensionId} ${item.name}`, item.critical ? 'yes' : '', item.reason, item.whatIsNeeded, item.evidence ? `Supplied by ${item.evidence.by}: ${item.evidence.note}` : 'Outstanding']);
  }

  const p = sheet(workbook, '8 Path to green', [
    { header: 'Order', width: 8 }, { header: 'Dimension', width: 42 }, { header: 'From', width: 8 }, { header: 'To', width: 8 },
    { header: 'Score gain', width: 11 }, { header: 'Why first', width: 15 }, { header: 'Findings to fix', width: 30 },
  ]);
  for (const step of report.pathToGreen.steps) {
    p.addRow([step.order, `${step.dimensionId} ${step.name}`, step.from, step.to, step.scoreGain, step.reason, step.findingIds.join(', ')]);
  }
  p.addRow([]);
  p.addRow([report.pathToGreen.note]);
  for (const need of report.pathToGreen.needsPerson) p.addRow([`A person must supply: ${need}`]);

  for (const ws of workbook.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => { c.alignment = { vertical: 'top', wrapText: true }; }));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
