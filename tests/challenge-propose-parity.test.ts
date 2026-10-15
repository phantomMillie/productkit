import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';

import { runInit } from '../src/cli/commands/init.js';
import { runFindingClaimHash, runInputHashes } from '../src/cli/commands/compute.js';
import { createMemoryOutput } from '../src/cli/output.js';
import { currentChallengeInputs } from '../src/clarification/challenge-store.js';
import { addFinding } from '../src/clarification/finding-store.js';
import { findingContentHash, toFindingInput } from '../src/schema/finding.js';
import { challengeAreas } from '../src/schema/challenge.js';
import { confirmedFixture, groupFixture, promptFixture } from './helpers/gate-fixtures.js';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
function cli(args: string[]) { return spawnSync(process.execPath, [path.resolve('dist/cli/bin.js'), ...args], { cwd: root, encoding: 'utf8' }); }

const findingInput = {
  issue_key: 'missing-payment-timeout', type: 'flow_gap' as const, severity: 'major' as const,
  statement: 'Payment timeout behavior is unspecified.', related_refs: [{ kind: 'node' as const, ref: 'NOD-001-1' }],
  evidence_refs: [{ kind: 'prompt' as const, ref: 'PRM-001', detail: 'Prompt omits timeout path.' }], counterexamples: [],
  ai_assessment: { is_ai_judgment: true as const, rationale: 'No timeout behavior found.', confidence: 'medium' as const, uncertainty: ['Could be in an external policy.'] }, questions: ['What happens on timeout?'],
};

async function workspace(): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), 'productkit-challenge-parity-'));
  await runInit({ cwd: root, now: new Date('2026-10-15T00:00:00Z') }, createMemoryOutput());
  const product = path.join(root, 'product');
  const prompt = promptFixture();
  const clarification = confirmedFixture(undefined, prompt);
  await writeFile(path.join(product, 'sources', `${prompt.id}.yaml`), stringify(prompt));
  await writeFile(path.join(product, 'discovery', `${clarification.id}.yaml`), stringify(clarification));
  await writeFile(path.join(product, 'nodes', 'NDG-001.yaml'), stringify(groupFixture(clarification.steps)));
  return product;
}

describe('challenge review order', () => {
  it('names the Finding that made a review stale and the correct order', async () => {
    const product = await workspace();
    const start = cli(['challenge', 'review-start']);
    const id = start.stdout.match(/Review (CHL-[0-9a-f]{16})/)?.[1];
    expect(id).toBeTruthy();
    const { finding } = await addFinding(product, findingInput);

    const area = cli(['challenge', 'review-area', id!, challengeAreas[0]!, '--status', 'reviewed']);
    expect(area.status).toBe(1);
    expect(area.stderr).toContain(`finding:${finding.id} added`);
    expect(area.stderr).toContain('Add Findings and record the user\'s confirmations first, then run review-start');
  });

  it('completes when Findings are recorded before review-start', async () => {
    const product = await workspace();
    await addFinding(product, findingInput);
    const id = cli(['challenge', 'review-start']).stdout.match(/Review (CHL-[0-9a-f]{16})/)?.[1];
    for (const area of challengeAreas) expect(cli(['challenge', 'review-area', id!, area, '--status', 'reviewed']).status).toBe(0);
    expect(cli(['challenge', 'review-complete', id!]).stdout).toContain('COMPLETE coverage');
  });
});

describe('compute hashes for Proposal and Decision inputs', () => {
  it('input-hashes lists the same hashes the gates compare against, filterable by kind', async () => {
    const product = await workspace();
    await addFinding(product, findingInput);
    const current = await currentChallengeInputs(product);

    const all = createMemoryOutput();
    await runInputHashes({ cwd: root }, all);
    expect(all.stdout).toHaveLength(current.inputs.length);
    for (const i of current.inputs) expect(all.stdout).toContain(`- { kind: ${i.kind}, ref: ${i.ref}, content_hash: ${i.content_hash} }`);

    const findings = createMemoryOutput();
    await runInputHashes({ cwd: root, kind: 'finding' }, findings);
    expect(findings.stdout).toHaveLength(1);
    expect(findings.stdout[0]).toMatch(/^- \{ kind: finding, ref: FND-[0-9a-f]{16}, content_hash: [0-9a-f]{64} \}$/);
  });

  it('finding-claim-hash matches the claim hash a Proposal must cite', async () => {
    const product = await workspace();
    const { finding } = await addFinding(product, findingInput);
    const output = createMemoryOutput();
    await runFindingClaimHash(finding.id, { cwd: root }, output);
    expect(output.stdout[0]).toBe(findingContentHash(toFindingInput(finding)));
  });
});

describe('Skills describe the gate inputs', () => {
  it('challenge starts the review after Findings and confirmations', async () => {
    const text = await readFile(path.resolve('skills/challenge/SKILL.md'), 'utf8');
    expect(text.indexOf('finding confirm')).toBeLessThan(text.indexOf('Only now run `productkit challenge review-start`'));
  });

  it('propose documents option IDs and the hash helpers', async () => {
    const text = await readFile(path.resolve('skills/propose/SKILL.md'), 'utf8');
    expect(text).toContain('^[A-Z][A-Z0-9_-]{1,31}$');
    expect(text).toContain('productkit compute input-hashes');
    expect(text).toContain('productkit compute finding-claim-hash');
  });
});
