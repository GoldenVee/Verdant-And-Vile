import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Loads .env into process.env so DB-backed tests (e2e) see DATABASE_URL.
    // Harmless for unit tests that don't read env.
    setupFiles: ['tests/setup/load-env.ts'],
  },
});
