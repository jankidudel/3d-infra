import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

void test('artifact targets package both backends and build the frontend only when requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inspectmesh-build-targets-'));
  try {
    for (const component of ['processor', 'api', 'frontend', 'bin']) {
      await mkdir(join(directory, component));
    }
    for (const component of ['processor', 'api']) {
      await writeFile(
        join(directory, component, 'Makefile'),
        `package:\n\t@echo packaged-${component}\n`,
      );
    }
    const npm = join(directory, 'bin', 'npm');
    await writeFile(npm, '#!/bin/sh\nprintf "frontend %s %s\\n" "$1" "$2"\n');
    await chmod(npm, 0o755);
    const args = [
      `PROCESSOR_DIR=${join(directory, 'processor')}`,
      `API_DIR=${join(directory, 'api')}`,
      `FRONTEND_DIR=${join(directory, 'frontend')}`,
    ];
    await assert.rejects(
      runFile('make', ['--no-print-directory', 'application-artifacts', 'STAGE=dev', ...args]),
      /Hosted development is disabled/,
    );
    for (const stage of ['prod']) {
      for (const target of ['backend-artifacts', 'application-artifacts']) {
        const { stdout } = await runFile(
          'make',
          ['--no-print-directory', target, `STAGE=${stage}`, ...args],
          {
            env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}` },
          },
        );
        assert.equal(stdout.match(/^packaged-processor$/gm)?.length, 1);
        assert.equal(stdout.match(/^packaged-api$/gm)?.length, 1);
        const frontendRuns = stdout.match(/^frontend run .+$/gm) ?? [];
        assert.deepEqual(
          frontendRuns,
          target === 'backend-artifacts' ? [] : ['frontend run build'],
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('deploy-all uses environment verification without rebuilding the frontend', async () => {
  const workflow = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.equal(workflow.match(/run: npm run verify\s*$/gm)?.length, 1);
  assert.match(workflow, /run: make backend-artifacts/);
  assert.doesNotMatch(workflow, /run: make application-artifacts/);
  assert.doesNotMatch(workflow, /npm run build/);
  assert.ok(workflow.includes('STAGE: prod'));
  assert.ok(workflow.includes('environment: prod'));
  assert.doesNotMatch(workflow, /inputs.environment|DEV_BASIC_AUTHORIZATION/);
  assert.ok(
    workflow.indexOf('run: npm run verify') < workflow.indexOf('run: make backend-artifacts'),
  );
});
