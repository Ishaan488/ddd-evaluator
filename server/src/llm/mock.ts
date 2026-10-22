import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types.js';

/**
 * A scripted provider for tests and offline demos. It reads the real prompt, so the
 * whole pipeline (prompt building, parsing, evidence checking, consolidation) runs
 * exactly as it would against a live model. The model name picks the behaviour:
 *
 *   raters:         mock-strict (3) · mock-mid (4) · mock-lenient (5) · mock-low (1)
 *                   mock-alarmist (scores 5 but raises a HIGH finding) · mock-garbage (not JSON) ·
 *                   mock-nocite (no evidence) · mock-abstain · mock-down
 *   consolidators:  mock-consolidator · mock-consolidator-unresolved · mock-consolidator-greedy · mock-consolidator-down
 */

interface Cell {
  sheet: string;
  cell: string;
  quote: string;
}

const FIXED_SCORES: Record<string, number> = {
  'mock-strict': 3,
  'mock-mid': 4,
  'mock-lenient': 5,
  'mock-low': 1,
  'mock-nocite': 4,
  'mock-alarmist': 5,
};

function section(prompt: string, tag: string): string {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt);
  return match?.[1] ?? '';
}

function firstCells(artifact: string, count: number): Cell[] {
  const cells: Cell[] = [];
  let sheet = '';
  for (const line of artifact.split('\n')) {
    const header = /^## Sheet: (.+?) \(/.exec(line);
    if (header) {
      sheet = header[1]!;
      continue;
    }
    for (const match of line.matchAll(/([A-Z]+\d+)=("(?:[^"\\]|\\.)*")/g)) {
      const text = JSON.parse(match[2]!) as string;
      if (text.length > 2 && !text.endsWith('…')) {
        cells.push({ sheet, cell: match[1]!, quote: text.slice(0, 30) });
        if (cells.length >= count) return cells;
      }
    }
  }
  return cells;
}

interface PromptDimension {
  id: string;
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock';

  constructor(private readonly delayMs = 0) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (request.model.endsWith('-down')) throw new LlmError(`${request.model} is unavailable`, 400);

    const text = request.system.includes('You are the consolidator')
      ? this.consolidate(request)
      : this.rate(request);
    return { text, inputTokens: Math.ceil(request.user.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }

  private rate(request: LlmRequest): string {
    if (request.model === 'mock-garbage') return 'I think the schema is fine overall.';
    const scorecard = JSON.parse(section(request.user, 'scorecard')) as { dimensions: PromptDimension[] };
    const cells = firstCells(section(request.user, 'artifact'), 3);
    const anchor = cells[0];
    const dimensions = scorecard.dimensions.map((dim, index) => {
      if (request.model === 'mock-abstain') {
        return { id: dim.id, score: null, not_measurable: true, rationale: 'The artifact cannot show this.', evidence: [] };
      }
      const score = FIXED_SCORES[request.model] ?? 4;
      const cell = cells[index % Math.max(cells.length, 1)];
      return {
        id: dim.id,
        score,
        not_measurable: false,
        anchor: `anchor for ${score}`,
        rationale: `${request.model} scored ${dim.id} ${score}.`,
        evidence: request.model === 'mock-nocite' || !cell ? [] : [cell],
      };
    });
    const alarmist = request.model === 'mock-alarmist';
    const findings = scorecard.dimensions
      .filter((_, index) => anchor && (alarmist ? index === 0 : (FIXED_SCORES[request.model] ?? 4) < 5))
      .map((dim) => ({
        dimension: dim.id,
        severity: alarmist ? 'HIGH' : (FIXED_SCORES[request.model] ?? 4) <= 3 ? 'MEDIUM' : 'LOW',
        title: `Improve ${dim.id}`,
        detail: `Could be clearer for ${dim.id}.`,
        location: { sheet: anchor!.sheet, cell: anchor!.cell },
        fix: 'Tighten the wording.',
        return_to: 'Define',
      }));
    const strengths = anchor
      ? [{ dimension: scorecard.dimensions[0]?.id ?? '', text: 'Consistent structure.', location: { sheet: anchor.sheet, cell: anchor.cell } }]
      : [];
    return JSON.stringify({ dimensions, findings, strengths });
  }

  private consolidate(request: LlmRequest): string {
    const results = JSON.parse(section(request.user, 'rater_results')) as {
      dimensions: Array<{ id: string; ratings: Array<{ score: number; evidence: Cell[] }> }>;
      findings: Array<{ ref: string; dimension: string; severity: string; title: string; detail: string; location: Cell | null; fix: string }>;
      strengths: Array<{ dimension: string; text: string; location: Cell | null }>;
    };

    const dimensions = results.dimensions.map((dim) => {
      const scores = dim.ratings.map((r) => r.score).sort((a, b) => a - b);
      const low = scores[0] ?? 0;
      const high = scores[scores.length - 1] ?? 0;
      const median = scores[Math.floor(scores.length / 2)] ?? 0;
      const chosen = request.model === 'mock-consolidator-greedy' ? 5 : median;
      const unresolved = request.model === 'mock-consolidator-unresolved' && high - low > 1;
      return {
        id: dim.id,
        score: chosen,
        resolved: !unresolved,
        basis: high - low > 1 ? 'claims_checked' : 'agreement',
        rationale: `Reconciled ${scores.join(', ')}.`,
        evidence: dim.ratings.flatMap((r) => r.evidence).slice(0, 1),
      };
    });

    const byDimension = new Map<string, typeof results.findings>();
    for (const finding of results.findings) {
      byDimension.set(finding.dimension, [...(byDimension.get(finding.dimension) ?? []), finding]);
    }
    const findings = [...byDimension.entries()].map(([dimension, group]) => ({
      from: group.map((f) => f.ref),
      dimension,
      severity: group[0]!.severity,
      title: group[0]!.title,
      detail: group[0]!.detail,
      location: group[0]!.location,
      fix: group[0]!.fix,
      return_to: 'Define',
    }));

    return JSON.stringify({ dimensions, findings, strengths: results.strengths.slice(0, 2) });
  }
}
