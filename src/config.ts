// Environment parsing with fail-fast validation. Env is loaded by Node's built-in
// --env-file flag (see package.json scripts), so this module only reads process.env.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export interface Config {
  databaseUrl: string;
  port: number;
  logLevel: string;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    port: Number.parseInt(optional('PORT', '3000'), 10),
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
