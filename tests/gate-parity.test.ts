import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';

import { runClarify } from '../src/cli/commands/clarify.js';
import { runCompute } from '../src/cli/commands/compute.js';
import { runGraphEdgeAdd } from '../src/cli/commands/graph.js';
import { runInit } from '../src/cli/commands/init.js';
import { runModel } from '../src/cli/commands/model.js';
import { createMemoryOutput } from '../src/cli/output.js';
import { clarificationContentHash, parseClarification } from '../src/schema/clarification.js';
import { parseGraphDocument } from '../src/schema/graph.js';
import { computeStructuralSignal } from '../src/schema/node.js';
import { confirmedFixture, groupFixture, promptFixture, validSteps } from './helpers/gate-fixtures.js';

/**
 * Rules the stage gates enforce must be reachable before a user is asked
 * anything, and every value a gate recomputes must be computable from the CLI.
 */

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function workspace(): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), 'productkit-parity-'));
  await runInit({ cwd: root, now: new Date('2026-10-15T00:00:00Z') }, createMemoryOutput());
  const product = path.join(root, 'product');
  await writeFile(path.join(product, 'sources', 'PRM-001.yaml'), stringify(promptFixture()));
  return product;
}

function draft(steps = validSteps()) {
  const { interpretation_check: _ic, ...rest } = confirmedFixture(steps);
  return { ...rest, status: 'awaiting_confirmation', interpretation_check: [] };
}

async function clarifyText(): Promise<string> {
  const output = createMemoryOutput();
  await runClarify({ cwd: root }, output);
  return output.stdout.join('\n');
}

describe('clarify pre-check before confirmation', () => {
  it('reports a structurally complete draft as only waiting for the user', async () => {
    const product = await workspace();
    await writeFile(path.join(product, 'discovery', 'CLR-001.yaml'), stringify(draft()));
    const text = await clarifyText();
    expect(text).toContain('No interpretation_check entry yet');
    expect(text).toContain('Pre-check: the steps pass every structural completion check');
  });

  it('names the structural problem before the user is asked', async () => {
    const product = await workspace();
    const steps = validSteps();
    steps.elaboration = steps.elaboration.map((e) => ({ ...e, statement: `${e.statement} (paraphrased)` }));
    await writeFile(path.join(product, 'discovery', 'CLR-001.yaml'), stringify(draft(steps)));
    const text = await clarifyText();
    expect(text).toContain('Fix before asking the user to confirm');
    expect(text).toContain('Elaboration must reference and cover decomposition statements exactly');
  });

  it('flags a missing prompt binding before the user is asked', async () => {
    const product = await workspace();
    const { prompt_content_hash: _hash, ...unbound } = draft();
    await writeFile(path.join(product, 'discovery', 'CLR-001.yaml'), stringify(unbound));
    expect(await clarifyText()).toContain('Set prompt_content_hash to the Prompt content_hash');
  });
});

describe('compute covers every hash the model gate recomputes', () => {
  it('clarification-content-hash and steps-hash let a NodeGroup pass the real model gate', async () => {
    const product = await workspace();
    const clrFile = path.join(product, 'discovery', 'CLR-001.yaml');
    await writeFile(clrFile, stringify(confirmedFixture()));

    const run = async (helper: 'steps-hash' | 'clarification-content-hash') => {
      const output = createMemoryOutput();
      await runCompute(helper, clrFile, {}, output);
      return output.stdout[0] ?? '';
    };
    const clr = parseClarification(await readFile(clrFile, 'utf8'));
    expect(await run('clarification-content-hash')).toBe(clarificationContentHash(clr));

    const group = groupFixture();
    await writeFile(path.join(product, 'nodes', 'NDG-001.yaml'), stringify({
      ...group,
      source_content_hash: await run('steps-hash'),
      clarification_content_hash: await run('clarification-content-hash'),
    }));
    const output = createMemoryOutput();
    await runModel({ cwd: root }, output);
    expect(output.stdout.join('\n')).toContain('NodeGroup modeled: NDG-001');
  });

  it('structural-signal matches the library', async () => {
    const statement = '결제가 완료되면 주문을 확정하고 이메일을 보낸다';
    const output = createMemoryOutput();
    await runCompute('structural-signal', '-', { stdin: `${statement}\n` }, output);
    expect(JSON.parse(output.stdout[0] ?? '')).toEqual(computeStructuralSignal(statement));
  });
});

describe('graph edge add', () => {
  it('stores a symmetric relation in canonical ID order instead of rejecting it', async () => {
    const product = await workspace();
    const clr = confirmedFixture();
    const group = groupFixture(clr.steps);
    group.nodes.push({ ...group.nodes[0]!, id: 'NOD-001-10' });
    group.nodes.push({ ...group.nodes[0]!, id: 'NOD-001-9' });
    await writeFile(path.join(product, 'discovery', 'CLR-001.yaml'), stringify(clr));
    await writeFile(path.join(product, 'nodes', 'NDG-001.yaml'), stringify(group));

    const edgeFile = path.join(root, 'edge.yaml');
    await writeFile(edgeFile, stringify({ id: 'EDG-001', type: 'conflicts_with', source: 'NOD-001-9', target: 'NOD-001-10', basis: 'ai_inferred', reason: 'SYNTHETIC: the two rules cannot both hold.', status: 'proposed', confirmations: [] }));
    const output = createMemoryOutput();
    await runGraphEdgeAdd({ cwd: root, input: edgeFile }, output);
    expect(output.stdout.join('\n')).toContain('stored as NOD-001-10 -> NOD-001-9');

    const graph = parseGraphDocument(await readFile(path.join(product, 'graph', 'edges.yaml'), 'utf8'));
    expect(graph.edges[0]).toMatchObject({ source: 'NOD-001-10', target: 'NOD-001-9' });
  });
});
