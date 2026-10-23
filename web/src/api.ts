import type {
  ConfigResponse,
  Decision,
  ProjectHistory,
  ProjectSummary,
  RunDetail,
} from '@ddd/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error ?? `The server answered ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export interface SubmitForm {
  workbook: File;
  scorecard: File;
  projectName: string;
  sources: string;
  instructions: string;
}

export interface ImportedQuestion {
  id: string;
  name: string;
  weight: number;
  critical: boolean;
  by: 'examiners' | 'person' | 'code';
  reads: string[];
  how?: string;
}

export interface ImportedScorecard {
  questions: ImportedQuestion[];
  yaml: string;
  uncertain: string[];
  adjustments: string[];
  summary: { dimensions: number; byExaminers: number; byCode: number; byPerson: number; critical: number; weightTotal: number };
  sourceText: string;
  documentOutline: string | null;
  model: { id: string; provider: string; model: string };
}

export interface CheckedScorecard {
  yaml: string;
  frozen: boolean;
  summary: ImportedScorecard['summary'];
}

export const api = {
  config: () => request<ConfigResponse>('/api/config'),
  projects: () => request<ProjectSummary[]>('/api/projects'),
  project: (id: string) => request<ProjectHistory>(`/api/projects/${id}`),
  run: (id: string) => request<RunDetail>(`/api/runs/${id}`),

  submit(form: SubmitForm) {
    const body = new FormData();
    body.append('workbook', form.workbook);
    body.append('scorecard', form.scorecard);
    body.append('projectName', form.projectName);
    body.append('sources', form.sources);
    body.append('instructions', form.instructions);
    return request<{ runId: string; projectId: string; iteration: number }>('/api/runs', { method: 'POST', body });
  },

  addEvidence: (runId: string, input: { dimensionId: string; score: number | null; note: string; by: string }) =>
    request<RunDetail>(`/api/runs/${runId}/evidence`, json(input)),

  override: (runId: string, input: { decision: Decision; reason: string; by: string }) =>
    request<RunDetail>(`/api/runs/${runId}/override`, json(input)),

  importScorecard(scorecard: File, document: File | null) {
    const body = new FormData();
    body.append('scorecard', scorecard);
    if (document) body.append('document', document);
    return request<ImportedScorecard>('/api/scorecards/import', { method: 'POST', body });
  },

  checkScorecard: (yaml: string, approvedBy?: string) => request<CheckedScorecard>('/api/scorecards/check', json({ yaml, approvedBy })),

  scorecardTemplateUrl: '/api/scorecard-template.xlsx',

  reportUrl: (runId: string, ext: 'xlsx' | 'pdf' | 'md' | 'json') => `/api/runs/${runId}/report.${ext}`,
};
