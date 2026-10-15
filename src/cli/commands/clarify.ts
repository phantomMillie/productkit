import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CliError, ExitCode, describeCause } from '../../errors.js';
import { latestId } from '../../clarification/io.js';
import { SKILLS_ROOT } from '../../clarification/skills.js';
import { ensureWorkspace, markStage, readSourcePrompt } from '../../clarification/workspace.js';
import {
  type CompletionBlockReason,
  judgeCompletion,
  parseClarification,
  preConfirmationIssue,
} from '../../schema/clarification.js';
import type { Output } from '../output.js';

export interface ClarifyOptions {
  prompt?: string | undefined;
  cwd?: string | undefined;
}

/**
 * Human-readable reasons. Note what these do and don't claim:
 * `content_changed_since_confirmation` and `integrity_violation` are things
 * the CLI *detected* by recomputing a hash — not something it *proved* or
 * *prevented*. Nothing here verifies that a `user_statement` is genuinely
 * the user's own words.
 */
const REASON_MESSAGES: Record<CompletionBlockReason, string> = {
  missing_prompt: 'The referenced Prompt is missing.',
  invalid_prompt_reference: 'Prompt identity does not match the clarification/confirmation.',
  prompt_integrity_violation: 'Prompt text/hash/spans are inconsistent.',
  prompt_changed_since_clarification: 'Prompt snapshot is missing or changed; review and re-confirm without overwriting the original.',
  incomplete_steps: 'Clarification has incomplete steps or placeholder output.',
  invalid_step_reference: 'Clarification step references do not resolve.',
  no_confirmation: 'No interpretation_check entry yet — nothing has been confirmed.',
  not_agreed: 'The latest interpretation_check entry is not "agreed".',
  missing_user_statement: 'The latest interpretation_check entry has no user_statement.',
  content_changed_since_confirmation:
    'The clarification steps changed after the last agreed entry — that entry no longer covers ' +
    'the current content. Re-confirmation is required.',
  integrity_violation:
    'An interpretation_check entry no longer matches its stored entry_hash. This means the ' +
    'record changed after it was written; it does not identify who changed it or why.',
};

export async function runClarify(options: ClarifyOptions, output: Output): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const productRoot = path.join(cwd, 'product');
  await ensureWorkspace(productRoot);

  const sourcesDir = path.join(productRoot, 'sources');
  const promptId = options.prompt ?? (await latestId(sourcesDir, 'PRM'));
  if (!promptId) {
    throw new CliError('No prompt found.', ExitCode.USAGE_OR_IO, [
      'Run "productkit intake <text>" first.',
    ]);
  }

  if (!/^PRM-\d{3,}$/.test(promptId)) throw new CliError('Invalid Prompt ID.', ExitCode.USAGE_OR_IO);
  const sourcePrompt = await readSourcePrompt(productRoot, promptId);
  if (!sourcePrompt) throw new CliError(`Prompt ${promptId} does not exist.`, ExitCode.USAGE_OR_IO);

  const clarificationId = `CLR-${promptId.slice('PRM-'.length)}`;
  const clarificationPath = path.join(productRoot, 'discovery', `${clarificationId}.yaml`);
  const instructionPath = path.join(SKILLS_ROOT, 'clarify', 'SKILL.md');

  let text: string | undefined;
  try {
    text = await readFile(clarificationPath, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new CliError(
        `Could not read ${clarificationPath}: ${describeCause(cause)}`,
        ExitCode.USAGE_OR_IO,
      );
    }
  }

  if (text === undefined) {
    await markStage(productRoot, 'discover', 'in_progress');
    output.out('AI action required: Clarification has not started.');
    output.out(`  Prompt:      ${path.relative(cwd, path.join(sourcesDir, `${promptId}.yaml`))}`);
    output.out(`  Instruction: ${instructionPath}`);
    output.out(`  Write to:    ${path.relative(cwd, clarificationPath)}`);
    output.out('  Completion contract: all steps need outputs; empty relation/counterexample lists need reviewed-no-items reasons.');
    output.out('  Bind prompt_ref + prompt_content_hash in the clarification and new confirmation; do not invent user agreement.');
    return;
  }

  let clarification;
  try {
    clarification = parseClarification(text);
  } catch (cause) {
    throw new CliError(
      `${clarificationPath} does not match the Clarification schema: ${describeCause(cause)}`,
      ExitCode.USAGE_OR_IO,
    );
  }

  if (clarification.id !== clarificationId || clarification.prompt_ref !== promptId) throw new CliError('Clarification identity/reference does not match the selected Prompt.', ExitCode.USAGE_OR_IO);
  const judgement = judgeCompletion(clarification, sourcePrompt);

  if (judgement.confirmed) {
    await markStage(productRoot, 'discover', 'done');
    output.out(`Clarification confirmed: ${clarificationId}`);
    output.out('(The record is internally consistent and marked agreed — this is not proof');
    output.out(' that a human actually said so; see docs/artifact-contracts.md.)');
    return;
  }

  await markStage(productRoot, 'discover', 'in_progress');
  output.out(`Clarification not yet complete: ${clarificationId}`);
  output.out(`  Reason: ${REASON_MESSAGES[judgement.reason]}`);
  if (judgement.detail) {
    output.out(`  Detail: ${judgement.detail}`);
  }
  if (WAITING_FOR_USER.has(judgement.reason)) {
    const pre = preConfirmationIssue(clarification, sourcePrompt);
    if (pre) {
      output.out(`  Fix before asking the user to confirm: ${REASON_MESSAGES[pre.reason]}`);
      if (pre.detail) output.out(`    ${pre.detail}`);
    } else {
      output.out('  Pre-check: the steps pass every structural completion check; only the user confirmation is missing.');
    }
  }
  output.out(`  Instruction: ${instructionPath}`);
}

/** Reasons that only a (new) user confirmation can clear. */
const WAITING_FOR_USER: ReadonlySet<CompletionBlockReason> = new Set([
  'no_confirmation',
  'not_agreed',
  'missing_user_statement',
  'content_changed_since_confirmation',
]);
