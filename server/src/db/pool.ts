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
