import pg from 'pg';
import type { AppConfig } from '../config.js';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<R>(work: (db: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

function wrap(target: Queryable, pool: pg.Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await target.query(sql, params);
      return result.rows as T[];
    },
    async tx<R>(work: (db: Db) => Promise<R>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const value = await work(wrap(client, pool));
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * A real Postgres when DATABASE_URL is set. Otherwise an in-memory Postgres (pg-mem)
 * that runs the very same SQL, so the app can be tried without Docker.
 */
export async function createDb(config: Pick<AppConfig, 'dbMode' | 'databaseUrl'>): Promise<Db> {
  if (config.dbMode === 'postgres' && config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    return wrap(pool, pool);
  }
  const { newDb } = await import('pg-mem');
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool() as unknown as pg.Pool;
  return wrap(pool, pool);
}

/**
 * Turns a failed database start-up into a message a person can act on, instead of a stack trace.
 * Returns null for errors it does not recognise (they are shown as they are).
 */
export function explainDbError(error: unknown, databaseUrl: string | undefined): string | null {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ''}` : String(error);
  let target = 'the database';
  try {
    if (databaseUrl) {
      const url = new URL(databaseUrl);
      target = `${url.hostname}:${url.port || '5432'}`;
    }
  } catch {
    /* an unparseable URL is reported below */
  }
  if (/ECONNREFUSED/.test(text) || (error as { errors?: Array<{ code?: string }> })?.errors?.some((e) => e.code === 'ECONNREFUSED')) {
    return [
      `Cannot reach Postgres at ${target}. DATABASE_URL is set but nothing is answering there.`,
      '  • Start it:  docker compose up -d db',
      '  • Or run without Postgres (the data is lost when the server stops): remove or empty DATABASE_URL in .env',
    ].join('\n');
  }
  if (/password authentication failed|28P01/.test(text)) {
    return `Postgres at ${target} rejected the user or password in DATABASE_URL. Check them in .env (docker-compose.yml uses ddd / ddd).`;
  }
  if (/database ".*" does not exist|3D000/.test(text)) {
    return `Postgres at ${target} has no such database. Create it, or point DATABASE_URL at one that exists (docker-compose.yml creates "ddd").`;
  }
  if (/Invalid URL|ERR_INVALID_URL/.test(text)) {
    return 'DATABASE_URL is not a valid connection string. It should look like postgres://user:password@localhost:5432/ddd';
  }
  return null;
}
