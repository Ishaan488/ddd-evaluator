import { describe, expect, it } from 'vitest';
import { parseScorecard } from '../src/scorecard/parse.js';
import { planSections } from '../src/agent/sectionPlanner.js';
import { buildRaterPromptForSection } from '../src/agent/prompt.js';
import { WorkbookModel } from '../src/excel/workbook.js';
import { estimateTokens } from '../src/agent/rater.js';
import { TALENTRA_XLSX, mockModels, runEvaluation } from './helpers.js';

describe('sectioned evaluation and section planner', () => {
  it('falls back to a single catch-all section when no reads field is specified', () => {
    const { scorecard } = parseScorecard(`
scorecard:
  id: SC-TEST
  version: "1.0"
  judges: D1 schema design
  frozen: true
  artifact:
    sheets:
      - { name: Tree, header_row: 1 }
      - { name: Allowed values, header_row: 1 }
  dimensions:
    - id: J01
      name: First dim
      weight: 1
      measured_by: raters
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
    - id: J02
      name: Second dim
      weight: 1
      measured_by: raters
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
`);
    const sections = planSections(scorecard);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toContain('full workbook');
    expect(sections[0]!.dimensions.map((d) => d.id)).toEqual(['J01', 'J02']);
    expect(sections[0]!.sheets.map((s) => s.name)).toEqual(['Tree', 'Allowed values']);
  });

  it('groups dimensions by their reads fingerprint into distinct sections', () => {
    const { scorecard } = parseScorecard(`
scorecard:
  id: SC-TEST-SECTIONED
  version: "1.0"
  judges: D1 schema design
  frozen: true
  artifact:
    sheets:
      - { name: Tree, header_row: 1 }
      - { name: Allowed values, header_row: 1 }
    context_sheets:
      - { name: Stage 1 steps, header_row: 1 }
  dimensions:
    - id: J01
      name: Tree only
      weight: 1
      measured_by: raters
      reads: [Tree]
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
    - id: J02
      name: Also Tree only
      weight: 1
      measured_by: raters
      reads: [Tree]
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
    - id: J03
      name: Tree and Context
      weight: 1
      measured_by: raters
      reads: [Tree, Stage 1 steps]
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
    - id: J04
      name: Catch-all no reads
      weight: 1
      measured_by: raters
      anchors: { 0: "bad", 1: "poor", 2: "fair", 3: "ok", 4: "good", 5: "great" }
`);
    const sections = planSections(scorecard);
    expect(sections).toHaveLength(3);

    // Section 1: Tree only (J01, J02)
    const treeSec = sections.find((s) => s.dimensions.some((d) => d.id === 'J01'))!;
    expect(treeSec.dimensions.map((d) => d.id)).toEqual(['J01', 'J02']);
    expect(treeSec.sheets.map((s) => s.name)).toEqual(['Tree']);
    expect(treeSec.context).toHaveLength(0);

    // Section 2: Tree + Stage 1 steps (J03)
    const ctxSec = sections.find((s) => s.dimensions.some((d) => d.id === 'J03'))!;
    expect(ctxSec.dimensions.map((d) => d.id)).toEqual(['J03']);
    expect(ctxSec.sheets.map((s) => s.name)).toEqual(['Tree']);
    expect(ctxSec.context.map((c) => c.name)).toEqual(['Stage 1 steps']);

    // Section 3: Catch-all without reads (J04)
    const catchAllSec = sections.find((s) => s.dimensions.some((d) => d.id === 'J04'))!;
    expect(catchAllSec.dimensions.map((d) => d.id)).toEqual(['J04']);
    expect(catchAllSec.sheets.map((s) => s.name)).toEqual(['Tree', 'Allowed values']);
  });

  it('reduces prompt token sizes dramatically when sectioned', async () => {
    const wb = await WorkbookModel.load(TALENTRA_XLSX);
    const { scorecard: fullScorecard } = parseScorecard(`
scorecard:
  id: SC-TALENTRA-D2-SECTIONED
  version: "1.0"
  judges: D1 schema design
  frozen: true
  artifact:
    sheets:
      - name: Tree
        header_row: 1
        columns: [Path id, Level, Name, Definition, Data type, Required, Allowed values, Example]
      - name: Allowed values
        header_row: 1
        columns: [List, Value, Meaning]
    context_sheets:
      - name: Stage 1 steps
        header_row: 4
        columns: [Step, Name, Purpose, Do, Produce, Done when]
      - name: Playbook map
        header_row: 4
        columns: [Playbook column, Playbook words, Section ID]
  dimensions:
    - id: J01
      name: Granularity is uniform
      weight: 4
      measured_by: raters
      reads: [Tree]
      anchors: { 0: a, 1: b, 2: c, 3: d, 4: e, 5: f }
    - id: J02
      name: Definitions are clear
      weight: 4
      measured_by: raters
      reads: [Tree]
      anchors: { 0: a, 1: b, 2: c, 3: d, 4: e, 5: f }
    - id: J03
      name: Allowed values
      weight: 4
      measured_by: raters
      reads: [Allowed values]
      anchors: { 0: a, 1: b, 2: c, 3: d, 4: e, 5: f }
`);
    const sections = planSections(fullScorecard);
    expect(sections).toHaveLength(2);

    const s1 = buildRaterPromptForSection({ scorecard: fullScorecard, section: sections[0]!, wb, sources: '' });
    const s2 = buildRaterPromptForSection({ scorecard: fullScorecard, section: sections[1]!, wb, sources: '' });

    const tokens1 = estimateTokens(s1.user);
    const tokens2 = estimateTokens(s2.user);

    // Neither section contains the full 18k+ workbook prompt
    expect(tokens1).toBeLessThan(14_000);
    expect(tokens2).toBeLessThan(8_000);
  });

  it('runs an end-to-end evaluation with sectioned dimensions and merges outcomes seamlessly', async () => {
    const parsed = parseScorecard(`
scorecard:
  id: SC-SECTIONED-E2E
  version: "1.0"
  judges: D1 schema design
  frozen: true
  artifact:
    sheets:
      - name: Tree
        header_row: 1
        columns: [Path id, Level, Name, Definition]
      - name: Allowed values
        header_row: 1
        columns: [List, Value, Meaning]
  dimensions:
    - id: J01
      name: Tree check
      weight: 5
      critical: false
      measured_by: raters
      reads: [Tree]
      anchors: { 0: bad, 1: poor, 2: fair, 3: ok, 4: good, 5: great }
    - id: J02
      name: Allowed values check
      weight: 5
      critical: false
      measured_by: raters
      reads: [Allowed values]
      anchors: { 0: bad, 1: poor, 2: fair, 3: ok, 4: good, 5: great }
`);

    const run = await runEvaluation({
      workbook: TALENTRA_XLSX,
      scorecard: parsed,
      models: mockModels(['mock-mid', 'mock-lenient', 'mock-strict']),
    });

    expect(run.core.dimensions.map((d) => d.id)).toEqual(['J01', 'J02']);
    expect(run.core.dimensions.every((d) => d.consolidated !== null)).toBe(true);
    // Participant outcomes merged for all 3 raters
    expect(run.runLog.participants).toHaveLength(4); // 3 raters + 1 consolidator
    const j01 = run.core.dimensions.find((d) => d.id === 'J01')!;
    const j02 = run.core.dimensions.find((d) => d.id === 'J02')!;
    expect(j01.raterScores).toBeDefined();
    expect(j02.raterScores).toBeDefined();
    expect(run.core.findings.length).toBeGreaterThanOrEqual(0);
  });
});
