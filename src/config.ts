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

export type NodeEnv = 'development' | 'test' | 'production';

export interface Config {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  databaseUrl: string;
  port: number;
  logLevel: string;
}

function parseNodeEnv(): NodeEnv {
  const value = optional('NODE_ENV', 'development');
  return value === 'production' || value === 'test' ? value : 'development';
}

export function loadConfig(): Config {
  const nodeEnv = parseNodeEnv();
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    // Which database is chosen entirely by the value provided here: the local .env
    // (dev branch), or the host's environment variables (prod, main branch). The app
    // does not branch on environment to pick a database.
    databaseUrl: required('DATABASE_URL'),
    port: Number.parseInt(optional('PORT', '3000'), 10),
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
