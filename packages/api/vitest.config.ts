import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    /**
     * Voir `test/argon2-wasm.setup.ts` : sans lui, les 26 tests
     * d'authentification ne s'executent pas du tout.
     */
    setupFiles: ['./test/argon2-wasm.setup.ts'],
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
    testTimeout: 10000,
  },
});
