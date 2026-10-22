import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Loads `.env` from the project root (and `server/.env` if present), wherever npm was started.
 * Values already in the real environment win, so CI and Docker can override the file.
 */
const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: [path.join(serverDir, '..', '.env'), path.join(serverDir, '.env')], quiet: true });
