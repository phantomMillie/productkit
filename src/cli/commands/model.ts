import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { CliError, ExitCode, describeCause } from '../../errors.js';
import { latestId } from '../../clarification/io.js';
import { SKILLS_ROOT } from '../../clarification/skills.js';
import { ensureWorkspace, markStage, readSourcePrompt } from '../../clarification/workspace.js';
import { parseProductConfig } from '../../schema/config.js';
import { judgeCompletion, parseClarification } from '../../schema/clarification.js';
import { type NodeGroupBlockReason, judgeNodeSetCompletion, parseNodeGroup } from '../../schema/node.js';
import type { Output } from '../output.js';

export interface ModelOptions {
  clarification?: string | undefined;
  cwd?: string | undefined;
}

/**
 * Human-readable reasons. `source_changed_since_modeling` and
 * `open_risk_findings` are things the CLI *detected* by recomputing a hash
 * or counting open records — not something it proved about meaning.
 */
const REASON_MESSAGES: Record<NodeGroupBlockReason, string> = {
  invalid_split_lineage: 'Split replacements must trace to preserved split-required Nodes with new IDs and matching source references.',
  missing_preservation_review: 'Each source item requires a substantive conditions/operators/exceptions preservation review.',
  invalid_source: 'Current confirmed Clarification and its intact Prompt source are required.',
  split_required: 'A final Node still requires splitting; preserve it as retired history and create new atomic Nodes.',
  incomplete_coverage: 'Some decomposition items are not yet covered by any Node.',
  atomicity_undetermined:
    'At least one Node has no determined atomicity.final (its sub-verdicts do not combine to a clear answer yet).',
  atomicity_final_mismatch:
    "At least one Node's stored atomicity.final does not match what its own sub-verdicts combine to. " +
    'The CLI recomputed it deterministically and found a mismatch (not a semantic re-judgement).',
  open_risk_findings:
    'At least one open addition/condition_change/operator_change/distortion finding candidate exists. ' +
    'This NodeGroup cannot be modeled until those are resolved, deferred, or dismissed (Change 05-06).',
  source_changed_since_modeling:
    'The source Clarification steps changed after this NodeGroup was modeled — it no longer covers the ' +
    'current content. Re-modeling is required.',
  invalid_reference:
    'At least one Node has a derived_from that does not resolve (wrong Clarification, or a ' +
    'decomposition_index out of range for the current steps).',
  unresolved_distortion_check:
    "At least one group-level distortion_check is not 'preserved' — the back-composition for that " +
    'decomposition item is distorted or uncertain, independent of any finding candidate.',
};

export async function runModel(options: ModelOptions, output: Output): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const productRoot = path.join(cwd, 'product');
  await ensureWorkspace(productRoot);

  const nodesDir = path.join(productRoot, 'nodes');
  if (!(await isDirectory(nodesDir))) {
    throw new CliError(`${nodesDir} does not exist.`, ExitCode.USAGE_OR_IO, [
      'This workspace was created before Change 03. Run "productkit init" again — ' +
        'it only adds missing paths and never touches your existing files.',
    ]);
  }

  const discoveryDir = path.join(productRoot, 'discovery');
  const clarificationId = options.clarification ?? (await latestId(discoveryDir, 'CLR'));
  if (!clarificationId) {
    throw new CliError('No Clarification found.', ExitCode.USAGE_OR_IO, [
      'Run "productkit intake" and "productkit clarify" first.',
    ]);
  }

  if (!/^CLR-\d{3,}$/.test(clarificationId)) throw new CliError('Invalid Clarification ID.', ExitCode.USAGE_OR_IO);
  const clarificationPath = path.join(discoveryDir, `${clarificationId}.yaml`);
  const clarificationText = await readRequired(clarificationPath, 'Clarification');
  let clarification;
  try {
    clarification = parseClarification(clarificationText);
  } catch (cause) {
    throw new CliError(
      `${clarificationPath} does not match the Clarification schema: ${describeCause(cause)}`,
      ExitCode.USAGE_OR_IO,
    );
  }

  if (clarification.id !== clarificationId) throw new CliError('Clarification ID does not match its file.', ExitCode.USAGE_OR_IO);
  const sourcePrompt = await readSourcePrompt(productRoot, clarification.prompt_ref);
  const clarificationJudgement = judgeCompletion(clarification, sourcePrompt);
  if (!clarificationJudgement.confirmed) {
    throw new CliError(
      `${clarificationId} is not confirmed yet (reason: ${clarificationJudgement.reason}).`,
      ExitCode.USAGE_OR_IO,
      ['Node modeling only accepts a confirmed Clarification. Run "productkit clarify" first.'],
    );
  }

  const groupId = `NDG-${clarificationId.slice('CLR-'.length)}`;
  const config = parseProductConfig(await readFile(path.join(productRoot, 'config.yaml'), 'utf8'));
  if (config.schema_version === 1) await markStage(productRoot, 'atomic_modeling', 'in_progress');
  const groupPath = path.join(nodesDir, `${groupId}.yaml`);
  const instructionPath = path.join(SKILLS_ROOT, 'model', 'SKILL.md');

  let groupText: string | undefined;
  try {
    groupText = await readFile(groupPath, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new CliError(`Could not read ${groupPath}: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
    }
  }

  if (groupText === undefined) {
    output.out('AI action required: Node modeling has not started.');
    output.out(`  Clarification: ${path.relative(cwd, clarificationPath)}`);
    output.out(`  Instruction:   ${instructionPath}`);
    output.out(`  Write to:      ${path.relative(cwd, groupPath)}`);
    output.out('  Completion contract: source_content_hash + clarification_content_hash; final atomic Nodes only.');
    output.out('  Every source item needs condition/operator/exception preservation reviews; retain split-required history in retired_nodes with split_from on new Nodes.');
    output.out('  Hashes and signals: productkit compute steps-hash | clarification-content-hash | structural-signal | atomicity-final.');
    return;
  }

  let group;
  try {
    group = parseNodeGroup(groupText);
  } catch (cause) {
    throw new CliError(
      `${groupPath} does not match the NodeGroup schema: ${describeCause(cause)}`,
      ExitCode.USAGE_OR_IO,
    );
  }

  if (group.id !== groupId || group.clarification_ref !== clarificationId) throw new CliError('NodeGroup identity/reference does not match its source.', ExitCode.USAGE_OR_IO);
  const judgement = judgeNodeSetCompletion(group, clarification.steps, { clarification, prompt: sourcePrompt });

  if (judgement.status === 'modeled') {
    if (config.schema_version === 1) await markStage(productRoot, 'atomic_modeling', 'done');
    output.out(`NodeGroup modeled: ${groupId}`);
    output.out('(Structural checks passed: coverage complete, every final Node is atomic,');
    output.out(' no open risk findings, and the source hash matches. This is not a semantic proof that');
    output.out(' the modeling is correct — see docs/artifact-contracts.md.)');
    return;
  }

  output.out(`NodeGroup not yet complete: ${groupId}`);
  for (const reason of judgement.reasons) {
    output.out(`  Reason: ${REASON_MESSAGES[reason]}`);
  }
  for (const line of judgement.detail) {
    output.out(`  Detail: ${line}`);
  }
  output.out(`  Instruction: ${instructionPath}`);
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readRequired(target: string, label: string): Promise<string> {
  try {
    return await readFile(target, 'utf8');
  } catch (cause) {
    throw new CliError(`${label} not found at ${target}: ${describeCause(cause)}`, ExitCode.USAGE_OR_IO);
  }
}
