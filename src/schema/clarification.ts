import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { promptIntegrityIssue, type Prompt } from './prompt.js';
import { isMeaningfulText } from './text.js';

import { canonicalJson, sha256Hex } from '../clarification/hash.js';

const hashHex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 hex digest');

/**
 * The six Clarification steps. `origin` on a definition item separates what
 * the user actually said from what the AI inferred — neither CLI nor spec
 * can verify that a `user_stated` entry is truthful; it only records which
 * bucket the author put it in (Constitution 2, 4).
 */
export const definitionItemSchema = z.object({
  term: z.string().min(1),
  meaning: z.string().min(1),
  origin: z.enum(['user_stated', 'ai_inferred']),
});

export const decompositionItemSchema = z.object({
  statement: z.string().min(1),
  span_refs: z.array(z.string().min(1)),
});

export const elaborationItemSchema = z.object({
  statement: z.string().min(1),
  actor: z.string().optional(),
  object: z.string().optional(),
  condition: z.string().optional(),
  action: z.string().optional(),
  result: z.string().optional(),
});

/**
 * A candidate relation, not a Graph edge. Change 04 owns typed, validated
 * edges; this change only records "these two statements look related".
 */
export const relationCheckItemSchema = z.object({
  statement_a: z.string().min(1),
  statement_b: z.string().min(1),
  relation_candidate: z.string().min(1),
});

export const counterexampleItemSchema = z.object({
  ambiguity: z.string().min(1),
  possible_interpretations: z.array(z.string().min(1)),
});

export const clarificationStepsSchema = z.object({
  definition: z.array(definitionItemSchema).default([]),
  decomposition: z.array(decompositionItemSchema).default([]),
  elaboration: z.array(elaborationItemSchema).default([]),
  relation_check: z.array(relationCheckItemSchema).default([]),
  counterexample: z.array(counterexampleItemSchema).default([]),
  relation_check_no_items_reason: z.string().optional(),
  counterexample_no_items_reason: z.string().optional(),
});

export type ClarificationSteps = z.infer<typeof clarificationStepsSchema>;

/**
 * One round of interpretation confirmation. `presented_hash` is the hash of
 * the *steps* at the time this entry was written (not of the prose summary)
 * — so if steps change after a round is agreed to, the next judgement sees a
 * mismatch and cannot treat the old agreement as still covering the new
 * content (design.md D7). `entry_hash` guards this entry's own fields
 * against being edited after the fact; it detects such a change, it does
 * not prevent someone from editing the file, and it says nothing about
 * whether `user_statement` is genuinely the user's words.
 */
export const interpretationCheckEntrySchema = z.object({
  id: z.string().min(1),
  presented_statement: z.string().min(1),
  presented_hash: hashHex,
  prompt_ref: z.string().regex(/^PRM-\d{3,}$/).optional(),
  prompt_content_hash: hashHex.optional(),
  user_response: z.enum(['agreed', 'disagreed', 'partially_agreed']),
  user_statement: z.string(),
  checked_at: z.string().min(1),
  entry_hash: hashHex,
});

export type InterpretationCheckEntry = z.infer<typeof interpretationCheckEntrySchema>;

export const findingCandidateSchema = z.object({
  statement: z.string().min(1),
  type: z.enum(['ambiguity', 'contradiction', 'missing_premise']),
  span_refs: z.array(z.string().min(1)),
});

export type FindingCandidate = z.infer<typeof findingCandidateSchema>;

export const clarificationStatusSchema = z.enum([
  'in_progress',
  'awaiting_confirmation',
  'confirmed',
]);

export const clarificationSchema = z.object({
  id: z.string().regex(/^CLR-\d{3,}$/, 'Clarification id must look like CLR-001'),
  prompt_ref: z.string().regex(/^PRM-\d{3,}$/, 'prompt_ref must look like PRM-001'),
  prompt_content_hash: hashHex.optional(),
  steps: clarificationStepsSchema,
  status: clarificationStatusSchema,
  interpretation_check: z.array(interpretationCheckEntrySchema).default([]),
  finding_candidates: z.array(findingCandidateSchema).default([]),
});

export type Clarification = z.infer<typeof clarificationSchema>;

export function parseClarification(yamlText: string): Clarification {
  return clarificationSchema.parse(parseYaml(yamlText));
}

/** Normalized hash of the steps shown to the user — not of the prose summary. */
export function stepsContentHash(steps: ClarificationSteps): string {
  return sha256Hex(canonicalJson(steps));
}

/**
 * Same as `stepsContentHash`, but takes the Clarification artifact's raw
 * YAML text directly. This exists so an Agent writing the artifact never
 * needs its own dependency on the `yaml` package — a consuming app's
 * node_modules layout does not guarantee `yaml` is resolvable from its own
 * root (it may be nested under productkit's own node_modules rather than
 * hoisted). Parsing happens inside productkit, where `yaml` is always
 * resolvable regardless of the consumer's dependency tree.
 */
export function stepsContentHashFromYaml(clarificationYamlText: string): string {
  const parsed = clarificationSchema.shape.steps.parse(
    (parseYaml(clarificationYamlText) as { steps: unknown }).steps,
  );
  return stepsContentHash(parsed);
}

/** Guards one interpretation_check entry against being edited after the fact. */
export function computeEntryHash(entry: Omit<InterpretationCheckEntry, 'entry_hash'>): string {
  return sha256Hex(canonicalJson(entry));
}

export type CompletionBlockReason =
  | 'no_confirmation'
  | 'not_agreed'
  | 'missing_user_statement'
  | 'content_changed_since_confirmation'
  | 'integrity_violation'
  | 'incomplete_steps'
  | 'invalid_step_reference'
  | 'missing_prompt'
  | 'invalid_prompt_reference'
  | 'prompt_integrity_violation'
  | 'prompt_changed_since_clarification';

export type CompletionJudgement =
  | { confirmed: true }
  | { confirmed: false; reason: CompletionBlockReason; detail?: string };

/**
 * The only authority on whether a Clarification is done. Never trusts the
 * file's own `status` field — recomputes from `steps` and
 * `interpretation_check` every call, the same way config.yaml's `stages`
 * are progress notes rather than verdicts (Constitution 9).
 */
export function judgeCompletion(clarification: Clarification, prompt?: Prompt): CompletionJudgement {
  for (const entry of clarification.interpretation_check) {
    const { entry_hash, ...rest } = entry;
    if (computeEntryHash(rest) !== entry_hash) {
      return {
        confirmed: false,
        reason: 'integrity_violation',
        detail: `interpretation_check entry ${entry.id} no longer matches its entry_hash`,
      };
    }
  }

  const latest = clarification.interpretation_check.at(-1);
  if (!latest) {
    return { confirmed: false, reason: 'no_confirmation' };
  }
  if (latest.user_response !== 'agreed') {
    return { confirmed: false, reason: 'not_agreed' };
  }
  if (latest.user_statement.trim().length === 0) {
    return { confirmed: false, reason: 'missing_user_statement' };
  }

  const currentHash = stepsContentHash(clarification.steps);
  if (latest.presented_hash !== currentHash) {
    return {
      confirmed: false,
      reason: 'content_changed_since_confirmation',
      detail: `steps changed after entry ${latest.id} was agreed to; re-confirmation is required`,
    };
  }

  const issue = clarificationStepsIssue(clarification.steps);
  if (issue) return issue;
  if (!isMeaningfulText(latest.presented_statement) || !isMeaningfulText(latest.user_statement)) {
    return { confirmed: false, reason: 'incomplete_steps', detail: 'Interpretation and user statement must not be placeholders.' };
  }
  if (!prompt) return { confirmed: false, reason: 'missing_prompt' };
  if (prompt.id !== clarification.prompt_ref || latest.prompt_ref !== clarification.prompt_ref) return { confirmed: false, reason: 'invalid_prompt_reference' };
  const promptIssue = promptIntegrityIssue(prompt);
  if (promptIssue) return { confirmed: false, reason: 'prompt_integrity_violation', detail: promptIssue };
  if (clarification.prompt_content_hash !== prompt.content_hash || latest.prompt_content_hash !== prompt.content_hash) return { confirmed: false, reason: 'prompt_changed_since_clarification', detail: 'Missing or stale Prompt snapshot; review against the current original and obtain a new confirmation.' };
  const spanIds = new Set(prompt.spans.map(s => s.id));
  if (clarification.steps.decomposition.some(d => d.span_refs.some(ref => !spanIds.has(ref))) || clarification.finding_candidates.some(f => f.span_refs.some(ref => !spanIds.has(ref)))) return { confirmed: false, reason: 'invalid_step_reference', detail: 'A source span reference does not resolve in the current Prompt.' };
  return { confirmed: true };
}

/**
 * Every completion check that does not depend on a user confirmation.
 * judgeCompletion reaches these only after an agreed entry exists, so a
 * structurally broken draft used to surface only after the user had already
 * confirmed it — and fixing it changed the steps hash and forced a second
 * confirmation. Running this first lets the Agent fix the draft before asking.
 */
export function preConfirmationIssue(clarification: Clarification, prompt?: Prompt): Extract<CompletionJudgement, { confirmed: false }> | undefined {
  const issue = clarificationStepsIssue(clarification.steps);
  if (issue) return issue;
  if (!prompt) return { confirmed: false, reason: 'missing_prompt' };
  if (prompt.id !== clarification.prompt_ref) return { confirmed: false, reason: 'invalid_prompt_reference' };
  const promptIssue = promptIntegrityIssue(prompt);
  if (promptIssue) return { confirmed: false, reason: 'prompt_integrity_violation', detail: promptIssue };
  if (clarification.prompt_content_hash !== prompt.content_hash) return { confirmed: false, reason: 'prompt_changed_since_clarification', detail: 'Set prompt_content_hash to the Prompt content_hash.' };
  const spanIds = new Set(prompt.spans.map(s => s.id));
  if (clarification.steps.decomposition.some(d => d.span_refs.some(ref => !spanIds.has(ref))) || clarification.finding_candidates.some(f => f.span_refs.some(ref => !spanIds.has(ref)))) return { confirmed: false, reason: 'invalid_step_reference', detail: 'A source span reference does not resolve in the current Prompt.' };
  return undefined;
}

/** Completion requirements are stricter than parsing an editable, unfinished draft. */
export function clarificationStepsIssue(steps: ClarificationSteps): Extract<CompletionJudgement, { confirmed: false }> | undefined {
  const incomplete = (detail: string) => ({ confirmed: false as const, reason: 'incomplete_steps' as const, detail });
  if (!clarificationStepsSchema.safeParse(steps).success) return incomplete('Invalid step structure.');
  if (!steps.definition.length || steps.definition.some(d => !isMeaningfulText(d.term) || !isMeaningfulText(d.meaning))) return incomplete('Definition requires substantive term/meaning records.');
  if (!steps.decomposition.length || steps.decomposition.some(d => !isMeaningfulText(d.statement) || !d.span_refs.length || d.span_refs.some(r => !isMeaningfulText(r)))) return incomplete('Decomposition requires statements with source span references.');
  if (!steps.elaboration.length || steps.elaboration.some(e => [e.statement, e.actor, e.object, e.condition, e.action, e.result].some(v => !isMeaningfulText(v)))) return incomplete('Elaboration requires statement, actor, object, condition, action and result.');
  const statements = new Set(steps.decomposition.map(d => d.statement));
  if (steps.elaboration.some(e => !statements.has(e.statement)) || steps.decomposition.some(d => !steps.elaboration.some(e => e.statement === d.statement))) return { confirmed: false, reason: 'invalid_step_reference', detail: 'Elaboration must reference and cover decomposition statements exactly.' };
  for (const relation of steps.relation_check) {
    if (![relation.statement_a, relation.statement_b, relation.relation_candidate].every(isMeaningfulText)) return incomplete('Relation review contains a placeholder.');
    if (!statements.has(relation.statement_a) || !statements.has(relation.statement_b) || relation.statement_a === relation.statement_b) return { confirmed: false, reason: 'invalid_step_reference', detail: 'Relation review must reference two distinct decomposition statements.' };
  }
  if (!steps.relation_check.length && !isMeaningfulText(steps.relation_check_no_items_reason)) return incomplete('Relation review requires candidates or an explicit reviewed-no-items reason.');
  if (steps.relation_check.length && steps.relation_check_no_items_reason !== undefined) return incomplete('Relation review cannot have candidates and a no-items assertion together.');
  if (steps.counterexample.some(c => !isMeaningfulText(c.ambiguity) || c.possible_interpretations.length < 2 || c.possible_interpretations.some(v => !isMeaningfulText(v)))) return incomplete('Counterexample requires an ambiguity and at least two substantive interpretations.');
  if (!steps.counterexample.length && !isMeaningfulText(steps.counterexample_no_items_reason)) return incomplete('Counterexample review requires records or an explicit reviewed-no-items reason.');
  if (steps.counterexample.length && steps.counterexample_no_items_reason !== undefined) return incomplete('Counterexample review cannot have records and a no-items assertion together.');
  return undefined;
}

/** NodeGroup binds to source identity, Prompt version and confirmation history, not only steps. */
export function clarificationContentHash(clarification: Clarification): string {
  const { status: _status, ...content } = clarification;
  return sha256Hex(canonicalJson(content));
}
