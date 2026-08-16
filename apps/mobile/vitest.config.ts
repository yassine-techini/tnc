/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the mobile app's pure logic.
 *
 * Deliberately NOT a component test setup: rendering React Native needs a
 * native runtime or a heavy shim, and a shim-rendered component proves things
 * about the shim. What is covered here is the logic that decides outcomes —
 * formatting, SSL pin validation, input validation — which is where a bug is
 * silent. Component and end-to-end coverage (Detox or Maestro on a device) is
 * still missing and is tracked as such.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.mjs'],
    globals: false,
  },
});
