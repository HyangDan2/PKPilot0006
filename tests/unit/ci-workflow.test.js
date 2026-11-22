import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* The GitHub App that pushes for the user has no `workflows` scope, so the CI
   definition cannot live in .github/workflows/ yet. It is kept ready in
   docs/ci-workflow.yml — and this test keeps it honest: the triggers, the
   commands and the artefacts it names must match what the repository actually
   runs. When the workflow is enabled, the same expectations hold. */

const root = resolve(__dirname, '../..');
const workflow = readFileSync(resolve(root, 'docs/ci-workflow.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('CI workflow definition', () => {
  it('runs on pull requests into main and on main itself', () => {
    expect(workflow).toMatch(/^name:\s*ci\s*$/m);
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  });

  it('runs the same checks as npm test', () => {
    expect(workflow).toContain('node tools/static-check.mjs');
    expect(workflow).toContain('npx vitest run');
    expect(workflow).toContain('npx playwright test');
    expect(workflow).toContain('npm ci');
    // the three commands are exactly what `npm test` chains
    const script = pkg.scripts.test;
    for (const command of ['node tools/static-check.mjs', 'vitest run', 'playwright test']) {
      expect(script).toContain(command);
    }
  });

  it('pins the runtime and uploads the failure artefacts', () => {
    expect(workflow).toMatch(/node-version:\s*22/);
    expect(workflow).toContain('actions/upload-artifact');
    expect(workflow).toContain('.playwright-artifacts');
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('documents why it is not active yet', () => {
    expect(workflow).toMatch(/workflows/);
    expect(workflow).toMatch(/403/);
  });

  it('is not half-copied into .github/workflows', () => {
    // an unreadable or stale copy in .github would run with different commands
    let active = null;
    try {
      active = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    } catch (_) {
      active = null;
    }
    if (active) expect(active).toBe(workflow);
  });
});
