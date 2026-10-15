import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../clarification/hash.js';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const referenceId = z.string().min(1);

export const findingTypeSchema = z.enum([
  'missing_requirement', 'missing_exception', 'policy_conflict', 'duplicate_policy',
  'flow_gap', 'logical_inconsistency', 'graph_relation_risk', 'semantic_distortion',
  'unverifiable_requirement', 'impact_coverage_gap', 'other',
]);
export const findingSeveritySchema = z.enum(['critical', 'major', 'minor']);
export const findingRefKindSchema = z.enum([
  'prompt', 'clarification', 'node_group', 'node', 'edge', 'relation_candidate', 'impact_report', 'finding', 'policy', 'definition', 'application',
]);
export const findingRefSchema = z.object({ kind: findingRefKindSchema, ref: referenceId }).strict();
export const findingEvidenceSchema = z.object({
  kind: findingRefKindSchema,
  ref: referenceId,
  detail: z.string().trim().min(1),
  source_hash: sha256.optional(),
}).strict().superRefine((evidence,ctx)=>{
  if(['policy','definition','application'].includes(evidence.kind)&&!evidence.source_hash)ctx.addIssue({code:'custom',path:['source_hash'],message:'Policy, Definition, and Application evidence requires a source hash.'});
});
export const findingCounterexampleSchema = z.object({
  condition: z.string().trim().min(1),
  expected: z.string().trim().min(1),
  observed: z.string().trim().min(1),
  status: z.enum(['hypothesis', 'observed']),
  evidence_refs: z.array(findingRefSchema).default([]),
}).strict();
export const findingAiAssessmentSchema = z.object({
  is_ai_judgment: z.literal(true),
  rationale: z.string().trim().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  uncertainty: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const findingInputSchema = z.object({
  issue_key: z.string().trim().min(1).max(160),
  type: findingTypeSchema,
  severity: findingSeveritySchema,
  statement: z.string().trim().min(1),
  related_refs: z.array(findingRefSchema).min(1),
  evidence_refs: z.array(findingEvidenceSchema).min(1),
  counterexamples: z.array(findingCounterexampleSchema),
  ai_assessment: findingAiAssessmentSchema,
  questions: z.array(z.string().trim().min(1)),
  supersedes_finding_ref: z.string().regex(/^FND-[0-9a-f]{16}$/).optional(),
}).strict().superRefine((finding, ctx) => {
  if (finding.type === 'other' && !finding.issue_key.toLowerCase().startsWith('other:')) {
    ctx.addIssue({ code: 'custom', path: ['issue_key'], message: 'Other Findings require an issue_key explaining the subtype.' });
  }
});
export type FindingInput = z.infer<typeof findingInputSchema>;

export const findingReviewStatusSchema = z.enum(['proposed', 'confirmed', 'rejected']);
export const findingResolutionStatusSchema = z.enum(['unresolved', 'resolved', 'deferred', 'dismissed']);

export const findingConfirmationSchema = z.object({
  id: z.string().regex(/^FCF-[0-9a-f]{16}$/),
  finding_ref: z.string().regex(/^FND-[0-9a-f]{16}$/),
  finding_hash: sha256,
  response: z.enum(['confirmed', 'rejected']),
  user_statement: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  checked_at: z.string().datetime({ offset: true }),
  entry_hash: sha256,
}).strict();
export type FindingConfirmation = z.infer<typeof findingConfirmationSchema>;

export const findingHistoryEntrySchema = z.object({
  id: z.string().regex(/^FHE-[0-9a-f]{16}$/),
  event: z.enum(['created', 'confirmation_recorded', 'resolution_recorded']),
  actor: z.enum(['agent', 'user', 'change06_decision']),
  prior_review_status: findingReviewStatusSchema.optional(),
  review_status: findingReviewStatusSchema,
  prior_resolution_status: findingResolutionStatusSchema.optional(),
  resolution_status: findingResolutionStatusSchema,
  finding_hash: sha256,
  statement: z.string().trim().min(1),
  decision_ref: z.string().regex(/^DEC-[A-Za-z0-9-]+$/).optional(),
  recorded_at: z.string().datetime({ offset: true }),
  entry_hash: sha256,
}).strict();
export type FindingHistoryEntry = z.infer<typeof findingHistoryEntrySchema>;

export const findingSchema = findingInputSchema.extend({
  schema_version: z.literal(1),
  id: z.string().regex(/^FND-[0-9a-f]{16}$/),
  fingerprint: sha256,
  review_status: findingReviewStatusSchema,
  resolution_status: findingResolutionStatusSchema,
  confirmation_history: z.array(findingConfirmationSchema).default([]),
  decision_ref: z.string().regex(/^DEC-[A-Za-z0-9-]+$/).optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  history: z.array(findingHistoryEntrySchema).min(1),
}).strict().superRefine((finding, ctx) => {
  const input = toFindingInput(finding);
  const fingerprint = findingFingerprint(input);
  if (finding.fingerprint !== fingerprint || finding.id !== `FND-${fingerprint.slice(0, 16)}`) {
    ctx.addIssue({ code: 'custom', path: ['fingerprint'], message: 'Finding ID/fingerprint does not match its immutable claim.' });
  }
  const contentHash = findingContentHash(input);
  finding.confirmation_history.forEach((entry, index) => {
    const { entry_hash: _entryHash, ...base } = entry;
    if (entry.finding_ref !== finding.id || entry.finding_hash !== contentHash || findingConfirmationEntryHash(base) !== entry.entry_hash) {
      ctx.addIssue({ code: 'custom', path: ['confirmation_history', index], message: 'Confirmation must bind to this immutable Finding and have a valid entry hash.' });
    }
  });
  const latestConfirmation = finding.confirmation_history.at(-1);
  const expectedReview = latestConfirmation?.response ?? 'proposed';
  if (finding.review_status !== expectedReview) {
    ctx.addIssue({ code: 'custom', path: ['review_status'], message: 'review_status must match the latest user confirmation; AI cannot set it.' });
  }
  if (finding.resolution_status !== 'unresolved' && !finding.decision_ref) {
    ctx.addIssue({ code: 'custom', path: ['decision_ref'], message: 'Finding resolution requires a Change 06 Decision reference.' });
  }
  if (finding.severity === 'critical' && ['deferred', 'dismissed'].includes(finding.resolution_status) && !finding.decision_ref) {
    ctx.addIssue({ code: 'custom', path: ['decision_ref'], message: 'Critical Finding scope exclusion requires a Decision reference.' });
  }
  const latestHistory = finding.history.at(-1);
  if (!latestHistory || latestHistory.review_status !== finding.review_status || latestHistory.resolution_status !== finding.resolution_status) {
    ctx.addIssue({ code: 'custom', path: ['history'], message: 'Latest history state must match the Finding state.' });
  }
  finding.history.forEach((entry, index) => {
    const { entry_hash: _entryHash, ...base } = entry;
    if (entry.finding_hash !== contentHash || findingHistoryEntryHash(base) !== entry.entry_hash) {
      ctx.addIssue({ code: 'custom', path: ['history', index], message: 'Finding history entry hash or content binding is invalid.' });
    }
    if (index === 0 && entry.event !== 'created') ctx.addIssue({ code: 'custom', path: ['history', index], message: 'The first history entry must be created.' });
    if (index > 0) {
      const previous = finding.history[index - 1]!;
      if (entry.prior_review_status !== previous.review_status || entry.prior_resolution_status !== previous.resolution_status) {
        ctx.addIssue({ code: 'custom', path: ['history', index], message: 'Finding history state transition does not continue the previous entry.' });
      }
    }
  });
});
export type Finding = z.infer<typeof findingSchema>;

export function normalizeFindingText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function findingFingerprint(input: FindingInput): string {
  const refs = [...input.related_refs].map((ref) => `${ref.kind}:${ref.ref}`).sort();
  return sha256Hex(canonicalJson({
    type: input.type,
    issue_key: normalizeFindingText(input.issue_key),
    statement: normalizeFindingText(input.statement),
    related_refs: refs,
  }));
}

export function findingContentHash(input: FindingInput): string {
  return sha256Hex(canonicalJson(input));
}

export function findingConfirmationEntryHash(entry: Omit<FindingConfirmation, 'entry_hash'>): string {
  return sha256Hex(canonicalJson(entry));
}

export function findingHistoryEntryHash(entry: Omit<FindingHistoryEntry, 'entry_hash'>): string {
  return sha256Hex(canonicalJson(entry));
}

export function toFindingInput(finding: Finding | Omit<Finding, 'history' | 'confirmation_history' | 'review_status' | 'resolution_status' | 'decision_ref' | 'created_at' | 'updated_at' | 'schema_version' | 'id' | 'fingerprint'>): FindingInput {
  return findingInputSchema.parse({
    issue_key: finding.issue_key,
    type: finding.type,
    severity: finding.severity,
    statement: finding.statement,
    related_refs: finding.related_refs,
    evidence_refs: finding.evidence_refs,
    counterexamples: finding.counterexamples,
    ai_assessment: finding.ai_assessment,
    questions: finding.questions,
    ...(finding.supersedes_finding_ref ? { supersedes_finding_ref: finding.supersedes_finding_ref } : {}),
  });
}

export function createFinding(inputValue: unknown, now = new Date()): Finding {
  const input = findingInputSchema.parse(inputValue);
  const fingerprint = findingFingerprint(input);
  const id = `FND-${fingerprint.slice(0, 16)}`;
  const finding_hash = findingContentHash(input);
  const recorded_at = now.toISOString();
  const historyBase = {
    id: `FHE-${sha256Hex(canonicalJson({ id, event: 'created', finding_hash })).slice(0, 16)}`,
    event: 'created' as const,
    actor: 'agent' as const,
    review_status: 'proposed' as const,
    resolution_status: 'unresolved' as const,
    finding_hash,
    statement: 'AI proposed Finding; not user-confirmed or resolved.',
    recorded_at,
  };
  const history = [{ ...historyBase, entry_hash: findingHistoryEntryHash(historyBase) }];
  return findingSchema.parse({
    ...input,
    schema_version: 1,
    id,
    fingerprint,
    review_status: 'proposed',
    resolution_status: 'unresolved',
    confirmation_history: [],
    created_at: recorded_at,
    updated_at: recorded_at,
    history,
  });
}

export function appendFindingConfirmation(
  findingValue: unknown,
  response: 'confirmed' | 'rejected',
  userStatement: string,
  rationale: string,
  now = new Date(),
): Finding {
  const finding = findingSchema.parse(findingValue);
  if (finding.resolution_status !== 'unresolved') throw new Error('A resolved Finding cannot be re-triaged by Change 05.');
  const input = toFindingInput(finding);
  const finding_hash = findingContentHash(input);
  const checked_at = now.toISOString();
  const confirmationBase = {
    id: `FCF-${sha256Hex(canonicalJson({ finding: finding.id, finding_hash, response, prior: finding.confirmation_history.length, checked_at })).slice(0, 16)}`,
    finding_ref: finding.id,
    finding_hash,
    response,
    user_statement: userStatement.trim(),
    rationale: rationale.trim(),
    checked_at,
  };
  const confirmation = findingConfirmationSchema.parse({
    ...confirmationBase,
    entry_hash: findingConfirmationEntryHash(confirmationBase),
  });
  const historyBase = {
    id: `FHE-${sha256Hex(canonicalJson({ finding: finding.id, event: 'confirmation_recorded', finding_hash, response, checked_at })).slice(0, 16)}`,
    event: 'confirmation_recorded' as const,
    actor: 'user' as const,
    prior_review_status: finding.review_status,
    review_status: response,
    prior_resolution_status: finding.resolution_status,
    resolution_status: finding.resolution_status,
    finding_hash,
    statement: confirmation.user_statement,
    recorded_at: checked_at,
  };
  const history = [...finding.history, { ...historyBase, entry_hash: findingHistoryEntryHash(historyBase) }];
  return findingSchema.parse({
    ...finding,
    review_status: response,
    confirmation_history: [...finding.confirmation_history, confirmation],
    updated_at: checked_at,
    history,
  });
}

/**
 * Records that a confirmed Finding was resolved by a content Decision whose
 * Application has been applied and verified (actor change06_decision). The
 * claim, its hash and the confirmation history are unchanged.
 */
export function appendFindingResolution(findingValue: unknown, decisionRef: string, statement: string, now = new Date()): Finding {
  const finding = findingSchema.parse(findingValue);
  if (finding.review_status !== 'confirmed') throw new Error('Only a confirmed Finding can be resolved by a Decision.');
  if (finding.resolution_status !== 'unresolved') throw new Error('Finding is already resolved, deferred or dismissed.');
  const finding_hash = findingContentHash(toFindingInput(finding));
  const recorded_at = now.toISOString();
  const historyBase = {
    id: `FHE-${sha256Hex(canonicalJson({ finding: finding.id, event: 'resolution_recorded', finding_hash, decision_ref: decisionRef, recorded_at })).slice(0, 16)}`,
    event: 'resolution_recorded' as const,
    actor: 'change06_decision' as const,
    prior_review_status: finding.review_status,
    review_status: finding.review_status,
    prior_resolution_status: finding.resolution_status,
    resolution_status: 'resolved' as const,
    finding_hash,
    statement,
    decision_ref: decisionRef,
    recorded_at,
  };
  return findingSchema.parse({
    ...finding,
    resolution_status: 'resolved',
    decision_ref: decisionRef,
    updated_at: recorded_at,
    history: [...finding.history, { ...historyBase, entry_hash: findingHistoryEntryHash(historyBase) }],
  });
}

/**
 * Hash of a Finding as it stood before any Decision resolved it. ChallengeRun,
 * Proposal and Decision snapshots cite Findings by this hash, so recording a
 * resolution (a consequence of a verified Decision) does not make the
 * Decision that caused it, its Proposal or the review stale. Before any
 * resolution it equals the full-record hash, so existing snapshots still match.
 */
export function findingSnapshotHash(finding: Finding): string {
  const index = finding.history.findIndex((entry) => entry.event === 'resolution_recorded');
  if (index < 0) return sha256Hex(canonicalJson(finding));
  const { decision_ref: _decisionRef, ...rest } = finding;
  return sha256Hex(canonicalJson({
    ...rest,
    resolution_status: finding.history[index]!.prior_resolution_status ?? 'unresolved',
    updated_at: finding.history[index - 1]!.recorded_at,
    history: finding.history.slice(0, index),
  }));
}

export function parseFinding(yamlText: string): Finding {
  return findingSchema.parse(parseYaml(yamlText));
}
