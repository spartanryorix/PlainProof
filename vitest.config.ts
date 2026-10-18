import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      DATA_DIR: path.resolve(__dirname, 'tests/.tmp/data'),
      PREVIEW_DELAY_MS: '0',
      LLM_BASE_URL: '',
      RETENTION_HOURS: '72',
    },
  },
});
