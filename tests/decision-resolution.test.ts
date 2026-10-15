import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify } from 'yaml';

import { confirmedFixture, groupFixture, promptFixture } from './helpers/gate-fixtures.js';
import { appendFindingConfirmation, createFinding, findingContentHash, findingSnapshotHash, parseFinding, toFindingInput } from '../src/schema/finding.js';
import { createChallengeRun, currentChallengeInputs, refreshChallengeRun, updateChallengeRun } from '../src/clarification/challenge-store.js';
import { challengeAreas } from '../src/schema/challenge.js';
import { addDecision, addProposal, decisionStaleness } from '../src/clarification/proposal-decision-store.js';
import { createPolicy, createProductDefinition, createJourney } from '../src/schema/definition.js';
import { applicationFreshness, applyApplication, createApplication, recordApplicationVerification } from '../src/clarification/definition-store.js';
import { createValidationReport } from '../src/clarification/validation-store.js';
import { computeImpactReport } from '../src/clarification/graph.js';
import { loadGraphWorkspace } from '../src/clarification/provenance.js';
import { readGraphDocument, readRelationCandidates } from '../src/clarification/graph-store.js';
import { canonicalJson, sha256Hex } from '../src/clarification/hash.js';
import { runArtifact, runTextHash } from '../src/cli/commands/compute.js';
import { runInit } from '../src/cli/commands/init.js';
import { createMemoryOutput } from '../src/cli/output.js';

/**
 * A user's content Decision, once applied and verified, resolves the Findings
 * it targets — without making that Decision, its Proposal or the review
 * stale — and a direct (non-option) Decision answers its Proposal.
 */

let temp = '';
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

async function pipeline(selection: 'proposal_option' | 'direct_user_decision', verifyStatus: 'verified' | 'inconclusive' = 'verified') {
  temp = await mkdtemp(path.join(os.tmpdir(), 'productkit-resolution-'));
  await runInit({ cwd: temp, now: new Date('2026-10-15T00:00:00Z') }, createMemoryOutput());
  const root = path.join(temp, 'product');
  const prompt = promptFixture();
  const clarification = confirmedFixture(undefined, prompt);
  await writeFile(path.join(root, 'sources', `${prompt.id}.yaml`), stringify(prompt));
  await writeFile(path.join(root, 'discovery', `${clarification.id}.yaml`), stringify(clarification));
  await writeFile(path.join(root, 'nodes', 'NDG-001.yaml'), stringify(groupFixture(clarification.steps)));

  const finding = appendFindingConfirmation(createFinding({ issue_key: 'critical-gap', type: 'missing_requirement', severity: 'critical', statement: 'The cancellation window is undefined.', related_refs: [{ kind: 'node', ref: 'NOD-001-1' }], evidence_refs: [{ kind: 'prompt', ref: prompt.id, detail: 'No window stated.' }], counterexamples: [], ai_assessment: { is_ai_judgment: true, rationale: 'Window missing.', confidence: 'medium', uncertainty: ['Synthetic.'] }, questions: ['What is the window?'] }), 'confirmed', 'SYNTHETIC USER: confirmed.', 'SYNTHETIC USER: reviewed.');
  await writeFile(path.join(root, 'findings', `${finding.id}.yaml`), stringify(finding));

  const { graph } = await readGraphDocument(root);
  const impact = computeImpactReport({ seedNodeId: 'NOD-001-1', graphEdges: graph.edges, candidates: await readRelationCandidates(root), workspace: await loadGraphWorkspace(root), createdAt: new Date().toISOString() });
  await mkdir(path.join(root, 'graph', 'reports'), { recursive: true });
  await writeFile(path.join(root, 'graph', 'reports', `${impact.analysis_id}.yaml`), stringify(impact));

  const run = await createChallengeRun(root);
  await updateChallengeRun(root, run.id, (r) => ({ ...r, status: 'complete', areas: Object.fromEntries(challengeAreas.map((a) => [a, { status: 'reviewed', rationale: 'SYNTHETIC REVIEW.', evidence_refs: [] }])) as typeof r.areas, history: [...r.history, { event: 'completed', at: new Date().toISOString(), statement: 'SYNTHETIC: all areas.', content_hash: r.review_hash }] }));

  const current = await currentChallengeInputs(root);
  const get = (kind: string, ref: string) => current.inputs.find((x) => x.kind === kind && x.ref === ref)!.content_hash;
  const claim = findingContentHash(toFindingInput(finding));
  const nodeHash = get('node', 'NOD-001-1');
  const option = (id: string) => ({ id, description: `SYNTHETIC ${id}`, evidence_refs: [{ kind: 'node' as const, ref: 'NOD-001-1', content_hash: nodeHash }], benefits: ['b'], costs: ['c'], risks: ['r'], assumptions: ['a'], expected_impacts: ['i'], side_effects: ['s'], target_candidates: [], finding_coverage: [{ finding_ref: finding.id, approach: 'approach', residual_issues: [] }] });
  const proposal = (await addProposal(root, { finding_refs: [{ finding_ref: finding.id, claim_hash: claim, review_status: 'confirmed' }], input_snapshot: [{ kind: 'node', ref: 'NOD-001-1', content_hash: nodeHash }], options: [option('OPT-A'), option('OPT-B')] })).proposal;

  const promptHash = get('prompt', prompt.id);
  const chosen = selection === 'proposal_option'
    ? { proposal_ref: proposal.id, option_ref: 'OPT-A', selection: { kind: 'proposal_option' as const, proposal_ref: proposal.id, option_ref: 'OPT-A' } }
    : { selection: { kind: 'direct_user_decision' as const, text: 'SYNTHETIC USER: OPT-A with a 24-hour window.' } };
  const decision = (await addDecision(root, { decision_type: 'content_decision', ...chosen, finding_refs: [{ finding_ref: finding.id, claim_hash: claim }], user_statement: 'SYNTHETIC USER ONLY.', rationale: 'Fixture.', scope: 'Fixture scope.', input_snapshot: [{ kind: 'prompt', ref: prompt.id, content_hash: promptHash }, { kind: 'finding', ref: finding.id, content_hash: get('finding', finding.id) }, { kind: 'proposal', ref: proposal.id, content_hash: proposal.claim_hash }] })).decision;

  const decisionRef = { kind: 'decision' as const, ref: decision.id, content_hash: decision.decision_hash };
  const promptRef = { kind: 'prompt' as const, ref: prompt.id, content_hash: promptHash };
  const nodeRef = { kind: 'node' as const, ref: 'NOD-001-1', content_hash: nodeHash };
  const provenance = { origin: 'user_decision' as const, source_refs: [nodeRef], decision_refs: [decisionRef], prompt_refs: [promptRef] };
  const policy = createPolicy({ schema_version: 1, id: 'POL-2222222222222222', context: 'Cancellation', actor: 'Customer', condition_text: 'within 24 hours', condition: { op: 'lte', field: 'hours', value_type: 'number', value: 24 }, action: 'accept', outcome: 'cancelled', exceptions: [], provenance });
  const definition = createProductDefinition({ schema_version: 1, status: 'draft', product_name: 'Fixture', items: [{ id: 'ITM-aaaaaaaaaaaa', kind: 'functional_requirement', text: 'Cancel within 24 hours.', provenance }], journey_refs: [], policy_refs: [policy.id], finding_refs: [finding.id], assumption_refs: [], input_snapshot: [promptRef, nodeRef, decisionRef], rules_version: 'definition/1' });
  const pcontent = stringify(policy);
  const dcontent = stringify(definition);
  const app = (await createApplication(root, { decision_ref: decision.id, decision_hash: decision.decision_hash, scope: 'Fixture', rationale: 'Fixture', targets: [
    { ref: { kind: 'policy', ref: policy.id, content_hash: policy.content_hash }, path: `product/policies/${policy.id}.yaml`, before_hash: null, after_hash: sha256Hex(pcontent), before_content: null, after_content: pcontent },
    { ref: { kind: 'definition', ref: definition.id, content_hash: definition.content_hash }, path: 'product/definition.yaml', before_hash: null, after_hash: sha256Hex(dcontent), before_content: null, after_content: dcontent },
  ], finding_refs: [finding.id], residual_risks: [], before_impact_refs: [impact.analysis_id] })).application;
  const applied = await applyApplication(root, app.id);
  const findingBefore = parseFinding(await readFile(path.join(root, 'findings', `${finding.id}.yaml`), 'utf8'));
  await recordApplicationVerification(root, applied.id, { status: verifyStatus, assessor: 'user', summary: 'SYNTHETIC.', evidence_refs: [decisionRef], uncertainty: ['Synthetic.'] });
  return { root, finding, findingBefore, decision, proposal, run, appId: applied.id, policy, promptHash, nodeHash, claim, get, impactId: impact.analysis_id };
}

describe('content Decisions resolve their Findings once verified', () => {
  it('records the resolution and keeps Decision, Application and review current', async () => {
    const { root, finding, findingBefore, decision, run, appId } = await pipeline('proposal_option');
    const after = parseFinding(await readFile(path.join(root, 'findings', `${finding.id}.yaml`), 'utf8'));
    expect(after.resolution_status).toBe('resolved');
    expect(after.decision_ref).toBe(decision.id);
    expect(after.history.at(-1)).toMatchObject({ event: 'resolution_recorded', actor: 'change06_decision', resolution_status: 'resolved' });

    expect(findingSnapshotHash(after)).toBe(findingSnapshotHash(findingBefore));
    expect(findingSnapshotHash(findingBefore)).toBe(sha256Hex(canonicalJson(findingBefore)));
    expect(await decisionStaleness(root)).toEqual([]);
    const app = parseYaml(await readFile(path.join(root, 'applications', `${appId}.yaml`), 'utf8'));
    expect((await applicationFreshness(root, app)).stale).toBe(false);
    const stored = (await import('../src/clarification/challenge-store.js')).readChallengeRuns;
    const saved = (await stored(root)).find((r) => r.id === run.id)!;
    expect((await refreshChallengeRun(root, saved)).stale).toBe(false);

    const report = await createValidationReport(root);
    expect(report.checks.find((c) => c.id === `finding.${finding.id}`)).toBeUndefined();
    expect(report.checks.some((c) => c.id === `finding.resolution.${finding.id}`)).toBe(false);
    expect(report.checks.some((c) => c.id.startsWith('proposal.'))).toBe(false);
  });

  it('does not resolve on an inconclusive verification', async () => {
    const { root, finding } = await pipeline('proposal_option', 'inconclusive');
    const after = parseFinding(await readFile(path.join(root, 'findings', `${finding.id}.yaml`), 'utf8'));
    expect(after.resolution_status).toBe('unresolved');
  });

  it('lets a direct user Decision that cites the Proposal answer it', async () => {
    const { root, finding } = await pipeline('direct_user_decision');
    const report = await createValidationReport(root);
    expect(report.checks.some((c) => c.id.startsWith('proposal.'))).toBe(false);
    expect(parseFinding(await readFile(path.join(root, 'findings', `${finding.id}.yaml`), 'utf8')).resolution_status).toBe('resolved');
  });

  it('snapshot hash equals the full-record hash before any resolution', () => {
    const finding = createFinding({ issue_key: 'k', type: 'flow_gap', severity: 'minor', statement: 's', related_refs: [{ kind: 'node', ref: 'NOD-001-1' }], evidence_refs: [{ kind: 'prompt', ref: 'PRM-001', detail: 'd' }], counterexamples: [], ai_assessment: { is_ai_judgment: true, rationale: 'r', confidence: 'low', uncertainty: ['u'] }, questions: [] });
    expect(findingSnapshotHash(finding)).toBe(findingSnapshotHash(parseFinding(stringify(finding))));
  });
});

describe('artifact hashing ignores surrounding whitespace', () => {
  it('createPolicy, createJourney and createProductDefinition accept padded text', () => {
    const ref = { kind: 'prompt' as const, ref: 'PRM-001', content_hash: 'a'.repeat(64) };
    const decision = { kind: 'decision' as const, ref: 'DEC-1111111111111111', content_hash: 'b'.repeat(64) };
    const provenance = { origin: 'user_decision' as const, source_refs: [ref], decision_refs: [decision], prompt_refs: [ref] };
    const policy = createPolicy({ schema_version: 1, id: 'POL-3333333333333333', context: 'ctx\n', actor: ' actor', condition_text: 'cond\n', condition: { op: 'eq', field: 'f', value_type: 'string', value: 'v' }, action: 'act', outcome: 'out\n', exceptions: [{ statement: 'exc\n', relation_ref: 'EDG-001', source_refs: [ref] }], provenance });
    expect(policy.context).toBe('ctx');
    const journey = createJourney({ schema_version: 1, actor: 'dev\n', goal: 'g', entry_state: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b', trigger: 't', decision_refs: ['DEC-1111111111111111'] }], terminal_states: ['b'], acceptance_criteria: ['ac\n'], provenance });
    expect(journey.actor).toBe('dev');
    const definition = createProductDefinition({ schema_version: 1, status: 'draft', product_name: 'P\n', items: [{ id: 'ITM-aaaaaaaaaaaa', kind: 'goal', text: 'goal text\n', provenance }], journey_refs: [], policy_refs: [], finding_refs: [], assumption_refs: [], input_snapshot: [ref], rules_version: 'definition/1' });
    expect(definition.product_name).toBe('P');
  });
});

describe('ImpactReport identity includes the seed Node', () => {
  it('two seeds over the same graph get different analysis IDs', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'productkit-impact-'));
    await runInit({ cwd: temp }, createMemoryOutput());
    const root = path.join(temp, 'product');
    const prompt = promptFixture();
    const clarification = confirmedFixture(undefined, prompt);
    const group = groupFixture(clarification.steps);
    group.nodes.push({ ...group.nodes[0]!, id: 'NOD-001-2' });
    await writeFile(path.join(root, 'sources', `${prompt.id}.yaml`), stringify(prompt));
    await writeFile(path.join(root, 'discovery', `${clarification.id}.yaml`), stringify(clarification));
    await writeFile(path.join(root, 'nodes', 'NDG-001.yaml'), stringify(group));
    const base = { graphEdges: (await readGraphDocument(root)).graph.edges, candidates: await readRelationCandidates(root), workspace: await loadGraphWorkspace(root), createdAt: '2026-10-15T00:00:00Z' };
    const a = computeImpactReport({ ...base, seedNodeId: 'NOD-001-1' });
    const b = computeImpactReport({ ...base, seedNodeId: 'NOD-001-2' });
    expect(a.analysis_id).not.toBe(b.analysis_id);
  });
});

describe('compute completes Policy and Journey drafts', () => {
  it('prints YAML whose hash fields validate and whose text-hash matches', async () => {
    const ref = { kind: 'prompt', ref: 'PRM-001', content_hash: 'a'.repeat(64) };
    const provenance = { origin: 'user_decision', source_refs: [ref], decision_refs: [{ kind: 'decision', ref: 'DEC-1111111111111111', content_hash: 'b'.repeat(64) }], prompt_refs: [ref] };
    const policyOut = createMemoryOutput();
    await runArtifact('policy', '-', { stdin: stringify({ schema_version: 1, id: 'POL-4444444444444444', context: 'c', actor: 'a', condition_text: 't', condition: { op: 'eq', field: 'f', value_type: 'string', value: 'v' }, action: 'x', outcome: 'o', exceptions: [], provenance }) }, policyOut);
    const policyText = `${policyOut.stdout.join('\n')}\n`;
    expect(parseYaml(policyText).content_hash).toMatch(/^[0-9a-f]{64}$/);
    const hashOut = createMemoryOutput();
    await runTextHash('-', { stdin: policyText }, hashOut);
    expect(hashOut.stdout[0]).toBe(sha256Hex(policyText));

    const journeyOut = createMemoryOutput();
    await runArtifact('journey', '-', { stdin: stringify({ schema_version: 1, actor: 'dev', goal: 'g', entry_state: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b', trigger: 't', decision_refs: ['DEC-1111111111111111'] }], terminal_states: ['b'], acceptance_criteria: ['ac'], provenance }) }, journeyOut);
    expect(parseYaml(journeyOut.stdout.join('\n')).id).toMatch(/^JRN-[0-9a-f]{16}$/);
  });
});

describe('amending after verification', () => {
  it('re-verifies an Application whose only drift is verification inputs', async () => {
    const { root, appId, policy } = await pipeline('proposal_option');
    // Any artifact-hash input change (here a second Policy file) drifts the verification fingerprint.
    const other = createPolicy({ ...policy, id: 'POL-5555555555555555', context: 'Another policy' });
    await writeFile(path.join(root, 'policies', `${other.id}.yaml`), stringify(other));
    const app = parseYaml(await readFile(path.join(root, 'applications', `${appId}.yaml`), 'utf8'));
    expect((await applicationFreshness(root, app)).reasons).toEqual(['Post-application verification inputs changed']);
    await recordApplicationVerification(root, appId, { status: 'verified', assessor: 'ai', summary: 'Re-assessed after an unrelated input changed.', evidence_refs: [], uncertainty: ['Synthetic.'] });
    const again = parseYaml(await readFile(path.join(root, 'applications', `${appId}.yaml`), 'utf8'));
    expect((await applicationFreshness(root, again)).stale).toBe(false);
  });

  it('a superseding Decision replaces the Policy and the superseded Application stops counting', async () => {
    const { root, appId, finding, proposal, policy, promptHash, claim, get, impactId } = await pipeline('proposal_option');
    const superseding = (await addDecision(root, { decision_type: 'content_decision', finding_refs: [{ finding_ref: finding.id, claim_hash: claim }], selection: { kind: 'direct_user_decision', text: 'SYNTHETIC USER: 48 hours instead.' }, user_statement: 'SYNTHETIC USER ONLY: change to 48h.', rationale: 'Fixture amendment.', scope: 'Fixture scope.', input_snapshot: [{ kind: 'prompt', ref: 'PRM-001', content_hash: promptHash }, { kind: 'finding', ref: finding.id, content_hash: get('finding', finding.id) }, { kind: 'proposal', ref: proposal.id, content_hash: proposal.claim_hash }], supersedes_decision_ref: (await decisionOf(root, appId)) })).decision;
    const amended = createPolicy({ ...policy, condition_text: 'within 48 hours', condition: { op: 'lte', field: 'hours', value_type: 'number', value: 48 }, provenance: { ...policy.provenance, decision_refs: [{ kind: 'decision', ref: superseding.id, content_hash: superseding.decision_hash }] } });
    const file = path.join(root, 'policies', `${policy.id}.yaml`);
    const before = await readFile(file, 'utf8');
    const after = stringify(amended);
    const plan = { decision_ref: superseding.id, decision_hash: superseding.decision_hash, scope: 'Amend', rationale: 'Amend', targets: [{ ref: { kind: 'policy', ref: amended.id, content_hash: amended.content_hash }, path: `product/policies/${amended.id}.yaml`, before_hash: sha256Hex(before), after_hash: sha256Hex(after), before_content: before, after_content: after }], finding_refs: [finding.id], residual_risks: [], before_impact_refs: [impactId] };
    const app = (await createApplication(root, plan)).application;
    await applyApplication(root, app.id);
    await recordApplicationVerification(root, app.id, { status: 'verified', assessor: 'ai', summary: 'Amendment applied.', evidence_refs: [], uncertainty: ['Synthetic.'] });

    const report = await createValidationReport(root);
    expect(report.checks.some((c) => c.id === `application.${appId}`)).toBe(false);
    expect(report.checks.find((c) => c.id === `application.${app.id}`)?.status).toBe('pass');
    expect(report.checks.some((c) => c.id.startsWith('proposal.'))).toBe(false);
  });
});

async function decisionOf(root: string, appId: string): Promise<string> {
  return parseYaml(await readFile(path.join(root, 'applications', `${appId}.yaml`), 'utf8')).plan.decision_ref;
}
