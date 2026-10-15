import { validSteps } from './helpers/gate-fixtures.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { runClarify } from '../src/cli/commands/clarify.js';
import { runCompute } from '../src/cli/commands/compute.js';
import { runInit } from '../src/cli/commands/init.js';
import { runIntake } from '../src/cli/commands/intake.js';
import { createMemoryOutput } from '../src/cli/output.js';
import { runCli } from '../src/cli/program.js';
import { CliError, ExitCode } from '../src/errors.js';
import { computeEntryHash, stepsContentHash, stepsContentHashFromYaml } from '../src/schema/clarification.js';
import { evaluateAtomicityFinal } from '../src/schema/node.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'productkit-compute-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function compute(helper: 'steps-hash' | 'entry-hash' | 'atomicity-final', source: string, stdin?: string): Promise<string> {
  const output = createMemoryOutput();
  await runCompute(helper, source, { cwd: root, stdin }, output);
  expect(output.stdout).toHaveLength(1);
  return output.stdout[0] ?? '';
}

describe('productkit compute', () => {
  it('steps-hash matches stepsContentHashFromYaml', async () => {
    const steps = validSteps(['Build a habit tracker.']);
    const yamlText = stringifyYaml({ id: 'CLR-001', prompt_ref: 'PRM-001', steps, status: 'in_progress' });
    await writeFile(path.join(root, 'clr.yaml'), yamlText);
    const printed = await compute('steps-hash', 'clr.yaml');
    expect(printed).toBe(stepsContentHashFromYaml(yamlText));
    expect(printed).toBe(stepsContentHash(steps));
  });

  it('entry-hash hashes every field but entry_hash, id included, and ignores a stale entry_hash', async () => {
    const entry = {
      id: 'IC-001',
      presented_statement: 'statement',
      presented_hash: 'a'.repeat(64),
      prompt_ref: 'PRM-001',
      prompt_content_hash: 'b'.repeat(64),
      user_response: 'agreed' as const,
      user_statement: 'yes',
      checked_at: '2026-10-15T00:00:00Z',
    };
    expect(await compute('entry-hash', '-', JSON.stringify(entry))).toBe(computeEntryHash(entry));
    expect(await compute('entry-hash', '-', JSON.stringify({ ...entry, entry_hash: 'c'.repeat(64) }))).toBe(computeEntryHash(entry));
    const { id: _id, ...withoutId } = entry;
    expect(computeEntryHash(withoutId as typeof entry)).not.toBe(computeEntryHash(entry));
  });

  it('atomicity-final matches evaluateAtomicityFinal, including null', async () => {
    const atomic = {
      single_verifiable_subject: { verdict: 'yes', reason: 'one subject' },
      decomposability: { verdict: 'not_applicable', reason: 'single' },
      meaning_preservation: { verdict: 'preserved', confidence: 'high', reason: 'kept' },
    } as const;
    expect(await compute('atomicity-final', '-', JSON.stringify(atomic))).toBe(String(evaluateAtomicityFinal(atomic)));
    const lost = { ...atomic, meaning_preservation: { verdict: 'distorted', confidence: 'high', reason: 'dropped' } };
    expect(await compute('atomicity-final', '-', JSON.stringify(lost))).toBe('null');
  });

  it('rejects a missing file, bad JSON and a wrong shape with exit 2', async () => {
    for (const [helper, source, stdin] of [
      ['steps-hash', 'missing.yaml', undefined],
      ['entry-hash', '-', '{not json'],
      ['entry-hash', '-', JSON.stringify({ id: 'IC-001' })],
      ['atomicity-final', '-', JSON.stringify({ single_verifiable_subject: { verdict: 'maybe' } })],
    ] as const) {
      const error = await runCompute(helper, source, { cwd: root, stdin }, createMemoryOutput()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USAGE_OR_IO);
    }
  });

  it('is registered on the CLI', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['compute', '--help'], output)).toBe(ExitCode.OK);
    const text = output.stdout.join('\n');
    expect(text).toContain('steps-hash');
    expect(text).toContain('entry-hash');
    expect(text).toContain('atomicity-final');
  });

  it('values produced only through compute pass the real Clarification gate', async () => {
    const at = new Date('2026-10-15T00:00:00Z');
    await runInit({ cwd: root, now: at }, createMemoryOutput());
    await runIntake({ cwd: root, now: at, text: 'Build a habit tracker.' }, createMemoryOutput());
    const prompt = parseYaml(await readFile(path.join(root, 'product/sources/PRM-001.yaml'), 'utf8')) as { content_hash: string };

    const clrPath = path.join(root, 'product/discovery/CLR-001.yaml');
    const clarification: Record<string, unknown> = {
      id: 'CLR-001',
      prompt_ref: 'PRM-001',
      prompt_content_hash: prompt.content_hash,
      steps: validSteps(['Build a habit tracker.']),
      status: 'awaiting_confirmation',
      interpretation_check: [],
      finding_candidates: [],
    };
    await writeFile(clrPath, stringifyYaml(clarification));

    const entry: Record<string, unknown> = {
      id: 'IC-001',
      presented_statement: 'Build a habit tracker.',
      presented_hash: await compute('steps-hash', 'product/discovery/CLR-001.yaml'),
      prompt_ref: 'PRM-001',
      prompt_content_hash: prompt.content_hash,
      user_response: 'agreed',
      user_statement: 'yes, that is it',
      checked_at: '2026-10-15T00:00:00Z',
    };
    entry.entry_hash = await compute('entry-hash', '-', JSON.stringify(entry));
    await writeFile(clrPath, stringifyYaml({ ...clarification, status: 'confirmed', interpretation_check: [entry] }));

    const output = createMemoryOutput();
    await runClarify({ cwd: root }, output);
    expect(output.stdout.join('\n')).toContain('Clarification confirmed: CLR-001');
  });
});
