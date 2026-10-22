import type { Report } from '@ddd/shared';

const cell = (text: string | number | null | undefined) =>
  String(text ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const where = (loc: { sheet: string; cell: string } | null) => (loc ? `${loc.sheet}!${loc.cell}` : '—');
const score = (value: number | null) => (value === null ? '—' : String(value));

/** The readable summary that goes next to the workbook (PDF page 16). */
export function renderMarkdown(report: Report): string {
  const { header, verdict } = report;
  const raterIds = header.raters.map((r) => r.id);
  const out: string[] = [];

  out.push(`# Evaluation report · ${header.projectName} · iteration ${header.iteration}`, '');
  out.push(`## 1. Header`, '');
  out.push(
    `| | |`,
    `|---|---|`,
    `| Artifact | ${cell(header.artifactName)} (\`${header.artifactHash.slice(0, 12)}\`) |`,
    `| Scorecard | ${cell(header.scorecardName)} v${cell(header.scorecardVersion)} (\`${header.scorecardHash.slice(0, 12)}\`) |`,
    `| Scorecard approval | ${cell(header.scorecardApproval ?? 'not stated')} |`,
    `| Gate | ${header.gate === 'D1' ? 'D1 schema design' : 'D3 output document'}${header.step ? ` · step ${cell(header.step)}` : ''} |`,
    `| Raters | ${header.raters.map((r) => `${r.id}: ${r.provider}/${r.model}`).join(' · ')} |`,
    `| Consolidator | ${header.consolidator.provider}/${header.consolidator.model} |`,
    `| Prompts | ${header.promptVersion} |`,
    `| Run | ${header.runId} · ${header.finishedAt} |`,
    '',
  );

  out.push(`## 2. Verdict`, '');
  out.push(`**${verdict.decision.toUpperCase()}** · weighted score **${verdict.weightedScore}** (accept ≥ ${verdict.thresholds.accept}, refine ≥ ${verdict.thresholds.refine})`);
  if (verdict.override) out.push('', `Agent verdict was ${verdict.agentDecision.toUpperCase()}; overridden by ${verdict.override.by}.`);
  out.push('', ...verdict.reasons.map((r) => `- ${r}`), '');
  if (verdict.criticalGates.length > 0) {
    out.push(`| Critical gate | Score | Result |`, `|---|---|---|`);
    for (const g of verdict.criticalGates) out.push(`| ${g.dimensionId} ${cell(g.name)} | ${score(g.score)} | ${g.status} |`);
    out.push('');
  }

  out.push(`## 3. Dimension scores`, '');
  out.push(`| ID | Dimension | Weight | By | ${raterIds.join(' | ')} | Score | Spread |`, `|---|---|---|---|${raterIds.map(() => '---').join('|')}|---|---|`);
  for (const d of report.dimensions) {
    out.push(
      `| ${d.id}${d.critical ? ' ★' : ''} | ${cell(d.name)} | ${d.weight} | ${d.measuredBy} | ${raterIds.map((id) => score(d.raterScores[id] ?? null)).join(' | ')} | ${score(d.consolidated)} | ${score(d.spread)} |`,
    );
  }
  out.push('', '★ critical gate (needs 4 or more)', '');

  out.push(`## 4. Strengths`, '');
  out.push(...(report.strengths.length > 0 ? report.strengths.map((s) => `- ${s.dimensionId}: ${s.text} (${where(s.location)})`) : ['None recorded.']), '');

  out.push(`## 5. Gaps and findings`, '');
  if (report.findings.length === 0) out.push('No findings.', '');
  else {
    out.push(`| ID | Severity | Dimension | Location | Finding | Fix | Return to |`, `|---|---|---|---|---|---|---|`);
    for (const f of report.findings) {
      out.push(`| ${f.id} | ${f.severity} | ${f.dimensionId} | ${where(f.location)} | ${cell(f.title)} | ${cell(f.fix)} | ${f.returnTo} |`);
    }
    out.push('');
  }

  out.push(`## 6. Rater agreement`, '');
  if (report.agreement.length === 0) out.push('No rater dimensions in this scorecard.', '');
  else {
    out.push(`| Dimension | ${raterIds.join(' | ')} | Spread | How it was resolved |`, `|---|${raterIds.map(() => '---').join('|')}|---|---|`);
    for (const a of report.agreement) {
      out.push(`| ${a.dimensionId} ${cell(a.name)} | ${raterIds.map((id) => score(a.scores[id] ?? null)).join(' | ')} | ${score(a.spread)} | ${cell(a.note)}${a.flagged ? ' **Flagged for a person.**' : ''} |`);
    }
    out.push('');
  }

  out.push(`## 7. Not measurable here`, '');
  if (report.notMeasurable.length === 0) out.push('Nothing. Every dimension was measured.', '');
  else {
    for (const n of report.notMeasurable) {
      const have = n.evidence ? `Supplied by ${n.evidence.by}${n.evidence.score !== null ? `, score ${n.evidence.score}` : ''}: ${n.evidence.note}` : '**Outstanding**';
      out.push(`- **${n.dimensionId} ${n.name}**${n.critical ? ' (critical)' : ''}: ${n.whatIsNeeded} ${have}`);
    }
    out.push('');
  }

  out.push(`## 8. Path to green`, '');
  const path = report.pathToGreen;
  if (path.steps.length === 0 && path.needsPerson.length === 0) out.push(path.note, '');
  else {
    path.steps.forEach((s) => out.push(`${s.order}. ${s.dimensionId} ${s.name}: ${s.from} → ${s.to} (+${s.scoreGain} points)${s.findingIds.length ? ` · fixes ${s.findingIds.join(', ')}` : ''}`));
    out.push('', path.note, `Resulting score ${path.resultingScore}, verdict ${path.resultingDecision.toUpperCase()}.`);
    if (path.needsPerson.length > 0) out.push('', `A person must supply: ${path.needsPerson.join('; ')}.`);
    out.push('');
  }

  if (report.notes.length > 0) out.push(`## Run notes`, '', ...report.notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}
