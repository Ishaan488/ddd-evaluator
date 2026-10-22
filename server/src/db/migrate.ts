import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies every .sql file in migrations/ once, in name order. Safe to run on every start. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.tx(async (tx) => {
      for (const statement of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
