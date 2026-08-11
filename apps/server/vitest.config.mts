import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const serverDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@travel-guide/config': resolve(serverDirectory, '../../packages/config/src/index.ts'),
      '@travel-guide/prompts': resolve(serverDirectory, '../../packages/prompts/src/index.ts'),
      '@travel-guide/shared-schemas': resolve(
        serverDirectory,
        '../../packages/shared-schemas/src/index.ts',
      ),
      '@travel-guide/shared-types': resolve(
        serverDirectory,
        '../../packages/shared-types/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.ts'],
  },
});
