import { existsSync } from 'node:fs';

/**
 * Loads `.env` for processes Next.js does not start itself: migrations, the
 * worker, the tick runner and seed scripts. Next loads its own env files, so
 * this is deliberately not called from the web layer.
 *
 * Real environment variables always win, which is what makes the same scripts
 * work unchanged in CI and in production where there is no file at all.
 */
export function loadEnvFile(path = '.env'): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}
