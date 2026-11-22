import { defineConfig } from 'vitest/config';

/* The suite is pure Node: the modules under test take their DOM, timers and
   storage by injection, so no jsdom/happy-dom is needed. Binding Vite to
   127.0.0.1 keeps it working in sandboxes without a `localhost` host entry. */
export default defineConfig({
  server: { host: '127.0.0.1' },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    reporters: ['default'],
    restoreMocks: true,
  },
});
