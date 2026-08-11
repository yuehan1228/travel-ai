import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const miniappDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(miniappDirectory, '../..');
const outputDirectory = resolve(miniappDirectory, 'miniprogram_npm');

const runPackageBuild = (packageName) => {
  const result = spawnSync('pnpm', ['--filter', packageName, 'build'], {
    cwd: repositoryDirectory,
    stdio: 'inherit',
  });

  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(`Failed to build ${packageName}`);
  }
};

const copyRuntimeFiles = (sourceDirectory, destinationDirectory) => {
  const entries = readdirSync(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationPath = join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      copyRuntimeFiles(sourcePath, destinationPath);
      continue;
    }

    const extension = extname(entry.name);
    if (!['.cjs', '.js', '.json', '.mjs'].includes(extension)) {
      continue;
    }

    mkdirSync(destinationDirectory, { recursive: true });
    writeFileSync(destinationPath, readFileSync(sourcePath));
  }
};

const copyCjsRuntimeFiles = (sourceDirectory, destinationDirectory) => {
  const entries = readdirSync(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const destinationName = entry.name.endsWith('.cjs')
      ? `${entry.name.slice(0, -4)}.js`
      : entry.name;
    const destinationPath = join(destinationDirectory, destinationName);

    if (entry.isDirectory()) {
      copyCjsRuntimeFiles(sourcePath, destinationPath);
      continue;
    }

    if (!entry.name.endsWith('.cjs')) {
      continue;
    }

    mkdirSync(destinationDirectory, { recursive: true });
    const source = readFileSync(sourcePath, 'utf8');
    writeFileSync(destinationPath, source.replaceAll('.cjs', '.js'));
  }
};

const copyCjsRuntimeFile = (sourcePath, destinationPath) => {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const source = readFileSync(sourcePath, 'utf8');
  writeFileSync(destinationPath, source.replaceAll('.cjs', '.js'));
};

const writePackageManifest = (directory, name, main, version = '0.1.0') => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, version, main }, null, 2)}\n`,
  );
};

const findZodDirectory = () => {
  const directCandidates = [
    resolve(miniappDirectory, 'node_modules/zod'),
    resolve(repositoryDirectory, 'node_modules/.pnpm/node_modules/zod'),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  const pnpmDirectory = resolve(repositoryDirectory, 'node_modules/.pnpm');
  if (existsSync(pnpmDirectory)) {
    const zodDirectoryName = readdirSync(pnpmDirectory).find((entry) => entry.startsWith('zod@'));
    if (zodDirectoryName !== undefined) {
      const candidate = resolve(pnpmDirectory, zodDirectoryName, 'node_modules/zod');
      if (existsSync(join(candidate, 'package.json'))) {
        return candidate;
      }
    }
  }

  throw new Error('Cannot find zod. Run pnpm install before building the miniapp runtime.');
};

runPackageBuild('@travel-guide/shared-types');
runPackageBuild('@travel-guide/shared-schemas');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const sharedTypesDirectory = resolve(repositoryDirectory, 'packages/shared-types/dist');
const sharedSchemasDirectory = resolve(repositoryDirectory, 'packages/shared-schemas/dist');
const bundledSharedTypesDirectory = resolve(outputDirectory, '@travel-guide/shared-types');
const bundledSharedSchemasDirectory = resolve(outputDirectory, '@travel-guide/shared-schemas');
const bundledZodDirectory = resolve(outputDirectory, 'zod');

copyRuntimeFiles(sharedTypesDirectory, bundledSharedTypesDirectory);
writePackageManifest(bundledSharedTypesDirectory, '@travel-guide/shared-types', 'index.js');

copyRuntimeFiles(sharedSchemasDirectory, bundledSharedSchemasDirectory);
writePackageManifest(bundledSharedSchemasDirectory, '@travel-guide/shared-schemas', 'index.js');

const zodDirectory = findZodDirectory();
copyCjsRuntimeFile(resolve(zodDirectory, 'index.cjs'), resolve(bundledZodDirectory, 'index.js'));
copyCjsRuntimeFiles(resolve(zodDirectory, 'v3'), resolve(bundledZodDirectory, 'v3'));
const zodPackage = JSON.parse(readFileSync(join(zodDirectory, 'package.json'), 'utf8'));
writePackageManifest(bundledZodDirectory, 'zod', 'index.js', zodPackage.version);

writeFileSync(
  resolve(outputDirectory, '.runtime-manifest.json'),
  `${JSON.stringify(
    {
      generatedBy: 'apps/miniapp/scripts/build-runtime.mjs',
      packages: ['@travel-guide/shared-types', '@travel-guide/shared-schemas', 'zod'],
    },
    null,
    2,
  )}\n`,
);
