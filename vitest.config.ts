import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Deterministic timezone so date math is testable regardless of host TZ
    env: { TZ: 'America/New_York' },
  },
});
