import { describe, expect, it } from 'vitest';
import { explainDbError } from '../src/db/pool.js';

const URL = 'postgres://ddd:ddd@localhost:5432/ddd';

describe('database start-up errors', () => {
  it('says how to start Postgres, or how to run without it, when nothing is listening', () => {
    const refused = Object.assign(new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' })]), { code: 'ECONNREFUSED' });
    const advice = explainDbError(refused, URL)!;
    expect(advice).toMatch(/Cannot reach Postgres at localhost:5432/);
    expect(advice).toMatch(/docker compose up -d db/);
    expect(advice).toMatch(/remove or empty DATABASE_URL/);
  });

  it('recognises a wrong password, a missing database and a malformed URL', () => {
    expect(explainDbError(new Error('password authentication failed for user "ddd"'), URL)).toMatch(/rejected the user or password/);
    expect(explainDbError(new Error('database "nope" does not exist'), URL)).toMatch(/has no such database/);
    expect(explainDbError(new Error('Invalid URL'), 'not a url')).toMatch(/not a valid connection string/);
  });

  it('leaves errors it does not understand alone, so they are not hidden', () => {
    expect(explainDbError(new Error('something unexpected'), URL)).toBeNull();
  });
});
