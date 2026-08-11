import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const miniappDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@travel-guide/shared-schemas': resolve(
        miniappDirectory,
        '../../packages/shared-schemas/src/index.ts',
      ),
      '@travel-guide/shared-types': resolve(
        miniappDirectory,
        '../../packages/shared-types/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.ts'],
  },
});
