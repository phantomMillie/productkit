import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { CliError, ExitCode } from '../errors.js';
import { createFinding, findingSchema, parseFinding, toFindingInput, appendFindingConfirmation, appendFindingResolution, findingContentHash, type Finding, type FindingInput } from '../schema/finding.js';
import { atomicCreateFile, atomicReplaceIfUnchanged } from './io.js';
import { loadGraphWorkspace } from './provenance.js';
import { readGraphDocument, readRelationCandidates } from './graph-store.js';
import { parseApplication, parsePolicy, parseProductDefinition } from '../schema/definition.js';
import { canonicalJson, sha256Hex } from './hash.js';

const findingsDir = (root: string) => path.join(root, 'findings');
async function yamlFiles(dir: string): Promise<string[]> { try { return (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; } }
export async function readFindings(root: string): Promise<Finding[]> {
  const dir = findingsDir(root); const out: Finding[] = [];
  for (const file of await yamlFiles(dir)) { const item = parseFinding(await readFile(path.join(dir, file), 'utf8')); if (`${item.id}.yaml` !== file) throw new CliError(`Finding filename does not match ID: ${file}`, ExitCode.GATE_BLOCKED); out.push(item); }
  return out;
}
export async function validateFindingReferences(root: string, finding: Finding): Promise<string[]> {
  const workspace = await loadGraphWorkspace(root); const { graph } = await readGraphDocument(root); const candidates = await readRelationCandidates(root);
  const findings = new Set((await readFindings(root)).map((f) => f.id)); const missing: string[] = [];
  for (const ref of [...finding.related_refs, ...finding.evidence_refs.map(({ kind, ref }) => ({ kind, ref })), ...finding.counterexamples.flatMap((c) => c.evidence_refs)]) {
    let exists = false;
    switch (ref.kind) {
      case 'prompt': exists = workspace.prompts.has(ref.ref); break;
      case 'node': exists = workspace.nodes.has(ref.ref); break;
      case 'node_group': exists = [...workspace.nodes.values()].some((n) => n.node_group_ref === ref.ref); break;
      case 'clarification': exists = [...workspace.nodes.values()].some((n) => n.clarification_ref === ref.ref); break;
      case 'edge': exists = graph.edges.some((e) => e.id === ref.ref); break;
      case 'relation_candidate': exists = candidates.some((c) => c.id === ref.ref); break;
      case 'impact_report': exists = (await yamlFiles(path.join(root, 'graph', 'reports'))).some((f) => path.basename(f, '.yaml') === ref.ref); break;
      case 'finding': exists = findings.has(ref.ref); break;
      case 'policy': { try { const item=parsePolicy(await readFile(path.join(root,'policies',`${ref.ref}.yaml`),'utf8'));exists=item.id===ref.ref;const evidence=finding.evidence_refs.find(e=>e.kind===ref.kind&&e.ref===ref.ref);if(evidence?.source_hash&&evidence.source_hash!==item.content_hash)exists=false; } catch { exists = false; } break; }
      case 'definition': { try { const item=parseProductDefinition(await readFile(path.join(root,'definition.yaml'),'utf8'));exists=item.id===ref.ref;const evidence=finding.evidence_refs.find(e=>e.kind===ref.kind&&e.ref===ref.ref);if(evidence?.source_hash&&evidence.source_hash!==item.content_hash)exists=false; } catch { exists = false; } break; }
      case 'application': { try { const item=parseApplication(await readFile(path.join(root,'applications',`${ref.ref}.yaml`),'utf8'));exists=item.id===ref.ref;const evidence=finding.evidence_refs.find(e=>e.kind===ref.kind&&e.ref===ref.ref);if(evidence?.source_hash&&evidence.source_hash!==sha256Hex(canonicalJson(item)))exists=false; } catch { exists = false; } break; }
    }
    if (!exists) missing.push(`${ref.kind}:${ref.ref}`);
  }
  return [...new Set(missing)];
}
export async function addFinding(root: string, input: FindingInput): Promise<{ finding: Finding; created: boolean }> {
  const proposed = createFinding(input); const unresolved = await validateFindingReferences(root, proposed);
  if (unresolved.length) throw new CliError(`Finding has unresolved references: ${unresolved.join(', ')}`, ExitCode.GATE_BLOCKED);
  const dir = findingsDir(root); await mkdir(dir, { recursive: true }); const file = path.join(dir, `${proposed.id}.yaml`);
  const text = stringifyYaml(proposed);
  if (await atomicCreateFile(file, text)) return { finding: proposed, created: true };
  const existingText = await readFile(file, 'utf8'); const existing = parseFinding(existingText);
  if (JSON.stringify(toFindingInput(existing)) !== JSON.stringify(toFindingInput(proposed))) throw new CliError(`Finding ID collision: ${proposed.id}`, ExitCode.GATE_BLOCKED);
  return { finding: existing, created: false };
}
export async function confirmFinding(root: string, id: string, response: 'confirmed' | 'rejected', statement: string, rationale: string): Promise<Finding> {
  const file = path.join(findingsDir(root), `${id}.yaml`); const before = await readFile(file, 'utf8'); const current = parseFinding(before);
  const missing = await validateFindingReferences(root, current); if (missing.length) throw new CliError(`Finding has unresolved references: ${missing.join(', ')}`, ExitCode.GATE_BLOCKED);
  const updated = appendFindingConfirmation(current, response, statement, rationale);
  await atomicReplaceIfUnchanged(file, before, stringifyYaml(updated)); return updated;
}

/**
 * Marks the Findings a content Decision targets as resolved once its
 * Application is applied and verified. Scope-exclusion Decisions never
 * resolve a Finding (the exclusion route keeps it unresolved by design), and
 * a Finding whose claim changed since the Decision is left alone.
 */
export async function resolveFindingsByDecision(root: string, decision: { id: string; decision_type: string; finding_refs: Array<{ finding_ref: string; claim_hash: string }> }, applicationId: string, now = new Date()): Promise<string[]> {
  if (decision.decision_type !== 'content_decision') return [];
  const resolved: string[] = [];
  for (const ref of decision.finding_refs) {
    const file = path.join(findingsDir(root), `${ref.finding_ref}.yaml`);
    let before: string;
    try { before = await readFile(file, 'utf8'); } catch { continue; }
    const current = parseFinding(before);
    if (current.review_status !== 'confirmed' || current.resolution_status !== 'unresolved') continue;
    if (findingContentHash(toFindingInput(current)) !== ref.claim_hash) continue;
    const updated = appendFindingResolution(current, decision.id, `Resolved by Decision ${decision.id} through verified Application ${applicationId}.`, now);
    await atomicReplaceIfUnchanged(file, before, stringifyYaml(updated));
    resolved.push(current.id);
  }
  return resolved;
}
