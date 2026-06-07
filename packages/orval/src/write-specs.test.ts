import { tmpdir } from 'node:os';
import path from 'node:path';

import { SupportedFormatter } from '@orval/core';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockExecaError } = vi.hoisted(() => ({
  MockExecaError: class MockExecaError extends Error {
    code?: string;
    constructor(message: string) {
      super(message);
      this.name = 'ExecaError';
    }
  },
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
  ExecaError: MockExecaError,
}));

vi.mock('./formatters/prettier', () => ({
  formatWithPrettier: vi.fn(),
}));

vi.mock('@orval/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orval/core')>();
  return {
    ...actual,
    log: vi.fn(),
    logWarning: vi.fn(),
    writeSplitTagsMode: vi.fn(),
  };
});

import { writeSplitTagsMode } from '@orval/core';
import { execa } from 'execa';

import { runFormatter, writeSpecs } from './write-specs';

const mockedExeca = vi.mocked(execa);
const mockedWriteSplitTagsMode = vi.mocked(writeSplitTagsMode);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runFormatter', () => {
  const paths = ['/tmp/a.ts', '/tmp/b.ts'];

  it('calls oxfmt with paths directly', async () => {
    mockedExeca.mockResolvedValueOnce(undefined as never);
    await runFormatter(SupportedFormatter.OXFMT, paths);
    expect(mockedExeca).toHaveBeenCalledWith('oxfmt', paths);
  });

  it('calls biome check --write with paths', async () => {
    mockedExeca.mockResolvedValueOnce(undefined as never);
    await runFormatter(SupportedFormatter.BIOME, paths);
    expect(mockedExeca).toHaveBeenCalledWith('biome', [
      'check',
      '--write',
      ...paths,
    ]);
  });

  it('delegates to formatWithPrettier for prettier', async () => {
    const { formatWithPrettier } = await import('./formatters/prettier');
    await runFormatter(SupportedFormatter.PRETTIER, paths, 'petstore');
    expect(formatWithPrettier).toHaveBeenCalledWith(paths, 'petstore');
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it('does nothing when formatter is undefined', async () => {
    await runFormatter(undefined, paths);
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it('logs a warning when binary is not found (ENOENT)', async () => {
    const { logWarning } = await import('@orval/core');
    const error = new MockExecaError('spawn oxfmt ENOENT');
    error.code = 'ENOENT';
    mockedExeca.mockRejectedValueOnce(error);

    await runFormatter(SupportedFormatter.OXFMT, paths, 'petstore');

    expect(logWarning).toHaveBeenCalledWith(
      expect.stringContaining('oxfmt not found'),
    );
  });
});

describe('writeSpecs workspace index', () => {
  it('does not export implementation paths that were not written (#3108)', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'orval-write-specs-'));
    const realPath = path.join(root, 'hooks', 'pets', 'pets.zod.ts');
    const missingPath = path.join(
      root,
      'hooks',
      'swaggerPetstore.schemas.zod.ts',
    );
    const indexPath = path.join(root, 'index.ts');

    try {
      mockedWriteSplitTagsMode.mockImplementationOnce(async () => {
        await fs.outputFile(realPath, 'export const pets = true;\n');
        return [realPath, missingPath];
      });
      const afterAllFilesWrite = vi.fn();

      await writeSpecs(
        {
          info: { title: 'Swagger Petstore' },
          operations: {},
          schemas: [],
          target: '',
          verbOptions: {},
          spec: {},
          extraFiles: [],
        } as Parameters<typeof writeSpecs>[0],
        root,
        {
          hooks: { afterAllFilesWrite: [afterAllFilesWrite] },
          output: {
            target: path.join(root, 'hooks', 'swaggerPetstore.zod.ts'),
            workspace: root,
            mode: 'tags-split',
            client: 'zod',
            fileExtension: '.zod.ts',
            schemaFileExtension: '.zod.ts',
            namingConvention: 'camelCase',
            indexFiles: true,
            mock: { generators: [] },
            override: {
              header: false,
              zod: { generateReusableSchemas: false },
            },
          },
        } as Parameters<typeof writeSpecs>[2],
      );

      const indexContent = await fs.readFile(indexPath, 'utf8');

      expect(indexContent).toContain(`export * from './hooks/pets/pets.zod';`);
      expect(indexContent).not.toContain('./hooks/swaggerPetstore.schemas.zod');
      expect(afterAllFilesWrite).toHaveBeenCalledWith(
        expect.arrayContaining([indexPath, realPath]),
      );
      expect(afterAllFilesWrite).not.toHaveBeenCalledWith(
        expect.arrayContaining([missingPath]),
      );
    } finally {
      await fs.remove(root);
    }
  });
});
