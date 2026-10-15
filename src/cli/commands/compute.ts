import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import { CliError, ExitCode, describeCause } from '../../errors.js';
import {
  clarificationContentHash,
  computeEntryHash,
  interpretationCheckEntrySchema,
  parseClarification,
  stepsContentHashFromYaml,
} from '../../schema/clarification.js';
import { atomicitySchema, computeStructuralSignal, evaluateAtomicityFinal } from '../../schema/node.js';
import type { Output } from '../output.js';

/**
 * Exposes the deterministic helpers that Skills previously reached through
 * `import('productkit')`. A globally installed package is not resolvable by
 * ESM import from a consuming app, but the CLI is always on PATH — so the
 * Agent calls the same library functions through here and gets exactly the
 * value the CLI gates recompute.
 */

export type ComputeHelper = 'steps-hash' | 'entry-hash' | 'atomicity-final' | 'clarification-content-hash' | 'structural-signal';

export interface ComputeOptions {
  cwd?: string | undefined;
  /** Injected stdin text for tests; real runs read process.stdin for `-`. */
  stdin?: string | undefined;
}

async function readInput(source: string, options: ComputeOptions): Promise<string> {
  if (source === '-') {
    if (options.stdin !== undefined) return options.stdin;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8');
  }
  const filePath = path.resolve(options.cwd ?? process.cwd(), source);
  try {
    return await readFile(filePath, 'utf8');
  } catch (cause) {
    throw new CliError(`Could not read ${source}: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
  }
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new CliError(`${source} is not valid JSON: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
  }
}

export async function runCompute(
  helper: ComputeHelper,
  source: string,
  options: ComputeOptions,
  output: Output,
): Promise<void> {
  const text = await readInput(source, options);

  if (helper === 'steps-hash') {
    let hash: string;
    try {
      hash = stepsContentHashFromYaml(text);
    } catch (cause) {
      throw new CliError(`Could not read Clarification steps from ${source}: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
    }
    output.out(hash);
    return;
  }

  if (helper === 'clarification-content-hash') {
    let hash: string;
    try {
      hash = clarificationContentHash(parseClarification(text));
    } catch (cause) {
      throw new CliError(`Could not read a Clarification from ${source}: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
    }
    output.out(hash);
    return;
  }

  if (helper === 'structural-signal') {
    const statement = text.replace(/\r?\n$/, '');
    if (statement.trim().length === 0) throw new CliError(`${source} has no statement text.`, ExitCode.USAGE_OR_IO);
    output.out(JSON.stringify(computeStructuralSignal(statement)));
    return;
  }

  if (helper === 'entry-hash') {
    // Same shape the completion gate re-hashes: every parsed field except
    // entry_hash, including id. Unknown keys are dropped exactly as the gate's
    // parse drops them.
    const parsed = interpretationCheckEntrySchema.omit({ entry_hash: true }).safeParse(parseJson(text, source));
    if (!parsed.success) {
      throw new CliError(`${source} is not an interpretation_check entry: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`, ExitCode.USAGE_OR_IO);
    }
    output.out(computeEntryHash(parsed.data));
    return;
  }

  const parsed = atomicitySchema.omit({ final: true }).safeParse(parseJson(text, source));
  if (!parsed.success) {
    throw new CliError(`${source} is not an atomicity review: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`, ExitCode.USAGE_OR_IO);
  }
  output.out(String(evaluateAtomicityFinal(parsed.data)));
}

export function registerComputeCommand(program: Command, output: Output): void {
  const compute = program
    .command('compute')
    .description('run a deterministic ProductKit helper (no LLM, no writes) and print its result');

  compute
    .command('steps-hash')
    .argument('<clarification>', 'Clarification YAML file, or - for stdin')
    .description('print the steps hash for interpretation_check.presented_hash')
    .action(async (source: string) => runCompute('steps-hash', source, {}, output));

  compute
    .command('entry-hash')
    .argument('<entry>', 'interpretation_check entry as JSON (entry_hash may be omitted), or - for stdin')
    .description('print entry_hash for an interpretation_check entry (hashes every field but entry_hash, id included)')
    .action(async (source: string) => runCompute('entry-hash', source, {}, output));

  compute
    .command('clarification-content-hash')
    .argument('<clarification>', 'Clarification YAML file, or - for stdin')
    .description('print clarification_content_hash for a NodeGroup (whole Clarification except status)')
    .action(async (source: string) => runCompute('clarification-content-hash', source, {}, output));

  compute
    .command('structural-signal')
    .argument('<statement>', 'file holding one Node statement, or - for stdin')
    .description('print a Node structural_signal as JSON (conjunction_count, multiple_predicates)')
    .action(async (source: string) => runCompute('structural-signal', source, {}, output));

  compute
    .command('atomicity-final')
    .argument('<atomicity>', 'atomicity review JSON without final, or - for stdin')
    .description('print the final atomicity verdict (atomic, split_required or null)')
    .action(async (source: string) => runCompute('atomicity-final', source, {}, output));
}
