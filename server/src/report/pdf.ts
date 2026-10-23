import PDFDocument from 'pdfkit';
import type { Decision, Report } from '@ddd/shared';
import { improvementPlan } from './improvements.js';

const INK = '#1b1b1f';
const MUTED = '#6b6b73';
const LINE = '#dcdce0';
const DECISION: Record<Decision, string> = { green: '#1f8a4c', amber: '#b7791f', red: '#b4322f' };
const SEVERITY: Record<string, string> = { HIGH: '#b4322f', MEDIUM: '#b7791f', LOW: '#2f6fb3', SCORE: '#6b6b73', PERSON: '#6b4bb3' };

/** The built-in PDF fonts only cover Latin-1, so swap the few symbols the report uses. */
const plain = (text: string | number | null | undefined) =>
  String(text ?? '')
    .replace(/[→]/g, '->')
    .replace(/[≥]/g, '>=')
    .replace(/[★]/g, '*')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, '');

const scoreColour = (score: number | null) => (score === null ? MUTED : score >= 4 ? DECISION.green : score >= 3 ? DECISION.amber : DECISION.red);

/** A printable report that leads with what to improve. */
export function renderPdf(report: Report): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: `Evaluation report - ${plain(report.header.projectName)}`, Author: 'DDD Evaluator' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const { header, verdict } = report;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const ensure = (needed: number) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
  };
  const heading = (text: string) => {
    ensure(60);
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(INK).text(plain(text), left, doc.y, { width });
    doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
  };
  const body = (text: string, colour = INK, size = 9.5) => {
    doc.font('Helvetica').fontSize(size).fillColor(colour).text(plain(text), left, doc.y, { width });
  };
  const pill = (text: string, colour: string, x: number, y: number) => {
    const w = doc.font('Helvetica-Bold').fontSize(8).widthOfString(plain(text)) + 12;
    doc.roundedRect(x, y, w, 14, 3).fill(colour);
    doc.fillColor('#ffffff').text(plain(text), x + 6, y + 3.5, { lineBreak: false });
    return w;
  };

  // Cover
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Evaluation report', left, doc.y, { width });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(plain(`${header.projectName} - iteration ${header.iteration}`), left, doc.y, { width });
  doc.moveDown(0.8);
  const top = doc.y;
  doc.roundedRect(left, top, width, 64, 6).fill(DECISION[verdict.decision]);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(verdict.decision.toUpperCase(), left + 16, top + 12, { lineBreak: false });
  doc.fontSize(11).text(`Score ${verdict.weightedScore} out of 100`, left + 16, top + 40, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).text(plain(`Green needs ${verdict.thresholds.accept} or more. Amber is ${verdict.thresholds.refine} to ${verdict.thresholds.accept - 1}.`), left + 230, top + 20, { width: width - 246 });
  doc.y = top + 78;
  for (const reason of verdict.reasons) body(`- ${reason}`);
  doc.moveDown(0.4);
  body(`Artifact: ${header.artifactName}   Scorecard: ${header.scorecardName} v${header.scorecardVersion}   Run: ${header.finishedAt}`, MUTED, 8.5);

  // Improvement plan
  const plan = improvementPlan(report);
  heading(`What to improve (${plan.length})`);
  if (plan.length === 0) body('Nothing to fix. Every dimension was measured and no findings were raised.');
  for (const row of plan) {
    ensure(70);
    const y = doc.y;
    let x = left;
    x += pill(row.severity === 'SCORE' ? 'LOW SCORE' : row.severity === 'PERSON' ? 'NEEDS A PERSON' : row.severity, SEVERITY[row.severity] ?? MUTED, x, y) + 8;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(plain(`${row.priority}. ${row.dimension}`), x, y + 2, { width: width - (x - left) - 70, lineBreak: false });
    if (row.gain !== null) doc.font('Helvetica').fontSize(8.5).fillColor(DECISION.green).text(`+${row.gain} pts`, left + width - 60, y + 2, { width: 60, align: 'right', lineBreak: false });
    doc.y = y + 20;
    body(row.problem);
    if (row.where) body(`Where: ${row.where}`, MUTED, 8.5);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Do this: ', left, doc.y, { width, continued: true });
    doc.font('Helvetica').text(plain(row.action));
    if (row.returnTo) body(`Go back to: ${row.returnTo}`, MUTED, 8.5);
    doc.moveDown(0.6);
  }

  // Scores
  heading('Scores by dimension');
  const raterIds = header.raters.map((r) => r.id);
  for (const d of report.dimensions) {
    ensure(34);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(plain(`${d.id}${d.critical ? ' *' : ''}  ${d.name}`), left, y, { width: width - 130, lineBreak: false });
    const raters = raterIds.map((id) => `${id}:${d.raterScores[id] ?? '-'}`).join('  ');
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(d.measuredBy === 'raters' ? raters : d.measuredBy, left + width - 200, y + 1, { width: 120, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(scoreColour(d.consolidated)).text(d.consolidated === null ? 'n/a' : `${d.consolidated}/5`, left + width - 70, y - 1, { width: 70, align: 'right', lineBreak: false });
    doc.y = y + 15;
    if (d.rationale) body(d.rationale.length > 260 ? `${d.rationale.slice(0, 257)}...` : d.rationale, MUTED, 8.5);
    doc.moveDown(0.3);
  }
  body('* critical dimension, needs 4 or more', MUTED, 8);

  // Strengths
  if (report.strengths.length > 0) {
    heading('What is already good');
    for (const s of report.strengths) body(`- ${s.dimensionId}: ${s.text}${s.location ? ` (${s.location.sheet}!${s.location.cell})` : ''}`);
  }

  // Path
  const path = report.pathToGreen;
  heading('Path to green');
  if (path.steps.length === 0) body(path.note);
  else {
    for (const s of path.steps) body(`${s.order}. ${s.dimensionId} ${s.name}: ${s.from} -> ${s.to} (+${s.scoreGain} points)`);
    doc.moveDown(0.3);
    body(`${path.note} Resulting score ${path.resultingScore}, verdict ${path.resultingDecision.toUpperCase()}.`);
  }
  if (path.needsPerson.length > 0) body(`A person must supply: ${path.needsPerson.join('; ')}.`, MUTED);

  // Run notes + footer
  if (report.notes.length > 0) {
    heading('Run notes');
    for (const n of report.notes) body(`- ${n}`, MUTED, 8.5);
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${plain(header.projectName)} - iteration ${header.iteration}   Page ${i + 1} of ${range.count}`, left, doc.page.height - 30, { width, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
