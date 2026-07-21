// Loads .env into process.env for tests. Vitest runs the suite in-process (not via
// `node --env-file`), so we parse .env ourselves. Minimal KEY=value parsing with #
// comments and optional surrounding quotes; existing env vars win.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

try {
  const content = readFileSync(join(process.cwd(), '.env'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // No .env present; env-dependent tests will surface their own clear errors.
}
