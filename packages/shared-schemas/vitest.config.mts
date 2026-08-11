import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const schemasDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@travel-guide/shared-types': resolve(schemasDirectory, '../shared-types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.ts'],
  },
});
