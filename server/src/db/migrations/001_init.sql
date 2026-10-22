-- DDD evaluator: one row per project (a schema being iterated), one per evaluation run,
-- and the per-run detail the PDF asks to keep: rater results, findings, human input.

create table projects (
  id          text primary key,
  name        text not null unique,
  step        text,
  created_at  timestamptz not null default now()
);

create table runs (
  id                text primary key,
  project_id        text not null references projects(id),
  iteration         integer not null,
  status            text not null,
  stage             text not null,
  gate              text,
  scorecard_id      text,
  scorecard_version text,
  scorecard_hash    text,
  scorecard         jsonb,
  sources           text,
  artifact_name     text,
  artifact_hash     text,
  artifact_path     text,
  progress          jsonb,
  weighted_score    double precision,
  agent_decision    text,
  final_decision    text,
  core              jsonb,
  run_log           jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  unique (project_id, iteration)
);

create index runs_project_idx on runs (project_id);

-- Every model call: the prompt, the raw reply, what was kept and what was discarded.
create table model_calls (
  run_id         text not null references runs(id),
  participant_id text not null,
  role           text not null,
  provider       text not null,
  model          text not null,
  family         text not null,
  status         text not null,
  attempts       integer not null,
  prompt_hash    text,
  prompt         text,
  raw_response   text,
  discarded      jsonb,
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  error          text,
  primary key (run_id, participant_id)
);

create table dimension_scores (
  run_id       text not null references runs(id),
  dimension_id text not null,
  name         text not null,
  weight       double precision not null,
  critical     boolean not null,
  measured_by  text not null,
  status       text not null,
  score        double precision,
  spread       double precision,
  resolution   text,
  flagged      boolean not null,
  rater_scores jsonb,
  primary key (run_id, dimension_id)
);

create table findings (
  run_id       text not null references runs(id),
  finding_id   text not null,
  fingerprint  text not null,
  severity     text not null,
  dimension_id text not null,
  sheet        text,
  cell         text,
  title        text not null,
  detail       text,
  fix          text,
  return_to    text,
  source       text not null,
  reported_by  text,
  primary key (run_id, finding_id)
);

create table human_evidence (
  id           text primary key,
  run_id       text not null references runs(id),
  dimension_id text not null,
  score        integer,
  note         text not null,
  by_name      text not null,
  created_at   timestamptz not null default now()
);

create table overrides (
  id         text primary key,
  run_id     text not null references runs(id),
  decision   text not null,
  reason     text not null,
  by_name    text not null,
  created_at timestamptz not null default now()
);
