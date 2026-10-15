import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { atomicCreateFile, atomicReplaceIfUnchanged } from './io.js';
import { graphNodeSnapshotHash, loadGraphWorkspace } from './provenance.js';
import { readGraphDocument, readRelationCandidates } from './graph-store.js';
import { readFindings } from './finding-store.js';
import { challengeAreas, challengeRunHash, challengeRunSchema, judgeChallengeCompletion, type ChallengeRun } from '../schema/challenge.js';
import { canonicalJson, sha256Hex } from './hash.js';
import { parseImpactReport } from '../schema/impact.js';
import { findingSnapshotHash } from '../schema/finding.js';
import { SKILLS_ROOT } from './skills.js';

const reviewDir = (root: string) => path.join(root, 'reviews');
async function files(dir: string): Promise<string[]> { try { return (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; } }
export async function currentChallengeInputs(root: string): Promise<{ inputs: Array<{ kind: string; ref: string; content_hash: string }>; scope: string[]; unavailable: Array<{ ref: string; reason: string }> }> {
  const snapshot = await loadGraphWorkspace(root); const inputs = [{ kind: 'workspace', ref: 'graph-workspace', content_hash: snapshot.fingerprint }]; const unavailable = snapshot.issues.map((i) => ({ ref: i.ref, reason: i.reason }));
  for (const [id, prompt] of snapshot.prompts) inputs.push({ kind: 'prompt', ref: id, content_hash: sha256Hex(canonicalJson(prompt)) });
  const groups = new Map<string, { clarification_ref: string; clarification_hash: string; node_group_hash: string }>();
  for (const [id, record] of snapshot.nodes) {
    inputs.push({ kind: 'node', ref: id, content_hash: graphNodeSnapshotHash(record) });
    groups.set(record.node_group_ref, { clarification_ref: record.clarification_ref, clarification_hash: record.clarification_hash, node_group_hash: record.node_group_hash });
  }
  for (const [id, group] of groups) {
    inputs.push({ kind: 'node_group', ref: id, content_hash: group.node_group_hash });
    inputs.push({ kind: 'clarification', ref: group.clarification_ref, content_hash: group.clarification_hash });
  }
  const { graph } = await readGraphDocument(root); inputs.push({ kind: 'graph', ref: 'graph.yaml', content_hash: sha256Hex(canonicalJson(graph)) });
  for (const edge of graph.edges) inputs.push({ kind: 'edge', ref: edge.id, content_hash: sha256Hex(canonicalJson(edge)) });
  const candidates = await readRelationCandidates(root); for (const item of candidates) inputs.push({ kind: 'relation_candidate', ref: item.id, content_hash: sha256Hex(canonicalJson(item)) });
  const graphRoot = path.join(root, 'graph'); const reportFiles = [...(await files(graphRoot)).filter((f) => f !== 'edges.yaml'), ...(await files(path.join(graphRoot, 'reports'))).map((f) => path.join('reports', f))];
  for (const file of reportFiles) { const raw = await readFile(path.join(graphRoot, file), 'utf8'); const parsed = parseImpactReport(raw); inputs.push({ kind: 'impact_report', ref: parsed.analysis_id, content_hash: sha256Hex(canonicalJson(parsed)) }); }
  for (const finding of await readFindings(root)) inputs.push({ kind: 'finding', ref: finding.id, content_hash: findingSnapshotHash(finding) });
  const skillText = await readFile(path.join(SKILLS_ROOT, 'challenge', 'SKILL.md'), 'utf8');
  inputs.push({ kind: 'skill', ref: 'challenge/SKILL.md', content_hash: sha256Hex(skillText) });
  inputs.push({ kind: 'rules', ref: 'challenge-rules-v1', content_hash: sha256Hex(canonicalJson({ version: 1, areas: challengeAreas })) });
  const scope = [...new Set([...snapshot.nodes.values()].map((n) => n.node_group_ref))].sort();
  return { inputs: inputs.sort((a,b) => `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`)), scope, unavailable };
}
export async function createChallengeRun(root: string): Promise<ChallengeRun> {
  const current = await currentChallengeInputs(root); const timestamp = new Date().toISOString();
  const id = `CHL-${sha256Hex(canonicalJson({ inputs: current.inputs, scope: current.scope })).slice(0, 16)}`;
  const areas = Object.fromEntries(challengeAreas.map((area) => [area, { status: 'not_reviewed', evidence_refs: [] }])) as unknown as ChallengeRun['areas'];
  const base = { schema_version: 1 as const, id, status: 'in_progress' as const, scope: { included: current.scope, excluded: [] }, areas, inputs: current.inputs, finding_refs: (await readFindings(root)).map((f) => f.id), unavailable_inputs: current.unavailable, skill_version: '1', rules_version: '1', created_at: timestamp, updated_at: timestamp, history: [{ event: 'created' as const, at: timestamp, statement: 'Challenge review checkpoint created.', content_hash: sha256Hex(canonicalJson(current)) }] };
  const run = challengeRunSchema.parse({ ...base, review_hash: challengeRunHash(base) }); await mkdir(reviewDir(root), { recursive: true });
  const file = path.join(reviewDir(root), `${id}.yaml`); if (await atomicCreateFile(file, stringifyYaml(run))) return run;
  const existing = challengeRunSchema.parse(await readFile(file, 'utf8').then((t) => import('yaml').then(({ parse }) => parse(t)))); return existing;
}
export async function readChallengeRuns(root: string): Promise<ChallengeRun[]> { const result: ChallengeRun[] = []; for (const file of await files(reviewDir(root))) { const run = challengeRunSchema.parse(await readFile(path.join(reviewDir(root), file), 'utf8').then((t) => import('yaml').then(({ parse }) => parse(t)))); result.push(run); } return result; }
export async function validateChallengeRunReferences(root: string, run: ChallengeRun): Promise<string[]> {
  const snapshot = await loadGraphWorkspace(root); const { graph } = await readGraphDocument(root); const candidates = await readRelationCandidates(root); const findings = await readFindings(root); const inputs = await currentChallengeInputs(root);
  const available = new Set<string>([
    ...[...snapshot.prompts.keys()].map((id) => `prompt:${id}`),
    ...[...snapshot.nodes.values()].flatMap((n) => [`node:${n.node.id}`, `node_group:${n.node_group_ref}`, `clarification:${n.clarification_ref}`]),
    ...graph.edges.map((e) => `edge:${e.id}`), ...candidates.map((c) => `relation_candidate:${c.id}`),
    ...findings.map((f) => `finding:${f.id}`), ...inputs.inputs.filter((i) => i.kind === 'impact_report').map((i) => `impact_report:${i.ref}`),
  ]);
  const missing = new Set<string>();
  for (const id of run.finding_refs) if (!findings.some((finding) => finding.id === id)) missing.add(`finding:${id}`);
  for (const [area, result] of Object.entries(run.areas)) for (const ref of result.evidence_refs) if (!available.has(`${ref.kind}:${ref.ref}`)) missing.add(`${area}:${ref.kind}:${ref.ref}`);
  return [...missing];
}
export async function updateChallengeRun(root: string, id: string, update: (run: ChallengeRun) => ChallengeRun): Promise<ChallengeRun> {
  const file = path.join(reviewDir(root), `${id}.yaml`); const before = await readFile(file, 'utf8'); const { parse } = await import('yaml'); const current = challengeRunSchema.parse(parse(before));
  const updated = update(current); const changed = { ...updated, updated_at: new Date().toISOString() };
  const final = challengeRunSchema.parse({ ...changed, review_hash: challengeRunHash(changed as ChallengeRun) }); await atomicReplaceIfUnchanged(file, before, stringifyYaml(final)); return final;
}
/** Names which inputs moved since a review started, so a stale error says why. */
export async function describeInputDrift(root: string, run: ChallengeRun): Promise<string[]> {
  const current = await currentChallengeInputs(root);
  const saved = new Map(run.inputs.map((i) => [`${i.kind}:${i.ref}`, i.content_hash]));
  const now = new Map(current.inputs.map((i) => [`${i.kind}:${i.ref}`, i.content_hash]));
  const drift: string[] = [];
  for (const [key, hash] of now) if (!saved.has(key)) drift.push(`${key} added`); else if (saved.get(key) !== hash) drift.push(`${key} changed`);
  for (const key of saved.keys()) if (!now.has(key)) drift.push(`${key} removed`);
  for (const item of current.unavailable) drift.push(`unavailable: ${item.ref} (${item.reason})`);
  return drift;
}

export const STALE_REVIEW_HINT = 'Findings (including user confirmations), Nodes, Graph records and the challenge Skill are review inputs. Add Findings and record the user\'s confirmations first, then run review-start, checkpoint every area and review-complete.';

export async function refreshChallengeRun(root: string, run: ChallengeRun): Promise<{ run: ChallengeRun; stale: boolean; completion: 'complete' | 'incomplete' }> {
  const current = await currentChallengeInputs(root); const stale = canonicalJson(current.inputs) !== canonicalJson(run.inputs) || canonicalJson(current.scope) !== canonicalJson(run.scope.included) || current.unavailable.length > 0;
  const completion = stale ? 'incomplete' : judgeChallengeCompletion({ ...run, status: run.status });
  return { run, stale, completion };
}
