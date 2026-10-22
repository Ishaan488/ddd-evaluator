import '../env.js';
import { loadAppConfig } from '../config.js';
import { migrate } from './migrate.js';
import { createDb, explainDbError } from './pool.js';

const config = loadAppConfig();
if (config.dbMode !== 'postgres') {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres.');
  process.exit(1);
}
try {
  const db = await createDb(config);
  const applied = await migrate(db);
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  await db.close();
} catch (error) {
  const advice = explainDbError(error, config.databaseUrl);
  if (!advice) throw error;
  console.error(advice);
  process.exit(1);
}
