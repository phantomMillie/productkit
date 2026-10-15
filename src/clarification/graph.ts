import { canonicalJson, sha256Hex } from './hash.js';
import {
  acyclicRelationTypes, candidateReviewEntryHash, edgeConfirmationSchema, graphEdgeClaimHash,
  graphRelationTypeSchema, relationKindAllowed, symmetricRelationTypes,
  type GraphEdge, type GraphRelationType, type RelationCandidate,
} from '../schema/graph.js';
import { impactReportSchema, type ImpactReport } from '../schema/impact.js';
import { graphNodeSnapshotHash, type GraphNodeRecord, type GraphWorkspaceSnapshot } from './provenance.js';

export interface GraphIssue { code: string; ref: string; detail: string }
export interface EffectiveEdge {
  edge: GraphEdge;
  status: 'confirmed' | 'proposed' | 'rejected';
  freshness: 'fresh' | 'stale';
  sourceSnapshotHash?: string;
  targetSnapshotHash?: string;
  issues: GraphIssue[];
}

export function canonicalizeEdgeEndpoints(type: GraphRelationType, source: string, target: string): { source: string; target: string } {
  if (symmetricRelationTypes.has(type) && source.localeCompare(target) > 0) return { source: target, target: source };
  return { source, target };
}

export function edgeSnapshotHash(record: GraphNodeRecord): string { return graphNodeSnapshotHash(record); }

function latestValidConfirmation(edge: GraphEdge): GraphEdge['confirmations'][number] | undefined {
  const last = edge.confirmations.at(-1);
  if (!last || last.edge_ref !== edge.id || last.edge_claim_hash !== graphEdgeClaimHash(edge)) return undefined;
  if (last.entry_hash !== sha256Hex(canonicalJson({
    id: last.id, edge_ref: last.edge_ref, edge_claim_hash: last.edge_claim_hash,
    endpoint_snapshot_hashes: last.endpoint_snapshot_hashes, user_response: last.user_response,
    user_statement: last.user_statement, rationale: last.rationale, checked_at: last.checked_at,
  }))) return undefined;
  return last;
}

export function effectiveEdge(edge: GraphEdge, nodes: Map<string, GraphNodeRecord>): EffectiveEdge {
  const issues: GraphIssue[] = [];
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) {
    issues.push({ code: 'missing_endpoint', ref: edge.id, detail: `Missing endpoint: ${!source ? edge.source : edge.target}` });
    return { edge, status: 'proposed', freshness: 'stale', issues };
  }
  const sourceSnapshotHash = edgeSnapshotHash(source);
  const targetSnapshotHash = edgeSnapshotHash(target);
  const confirmation = latestValidConfirmation(edge);
  if (edge.status === 'proposed' && edge.confirmations.length === 0) return { edge, status: 'proposed', freshness: 'fresh', sourceSnapshotHash, targetSnapshotHash, issues };
  if (!confirmation) {
    issues.push({ code: 'invalid_confirmation', ref: edge.id, detail: 'Latest confirmation is absent or its claim/hash is invalid.' });
    return { edge, status: 'proposed', freshness: 'stale', sourceSnapshotHash, targetSnapshotHash, issues };
  }
  if (confirmation.endpoint_snapshot_hashes.source !== sourceSnapshotHash || confirmation.endpoint_snapshot_hashes.target !== targetSnapshotHash) {
    issues.push({ code: 'stale_endpoint', ref: edge.id, detail: 'An endpoint snapshot changed after confirmation.' });
    return { edge, status: 'proposed', freshness: 'stale', sourceSnapshotHash, targetSnapshotHash, issues };
  }
  const status = confirmation.user_response === 'agreed' ? 'confirmed' : 'rejected';
  if (edge.status !== status) issues.push({ code: 'status_mismatch', ref: edge.id, detail: `Stored status ${edge.status} does not match latest response ${status}.` });
  return { edge, status: issues.length ? 'proposed' : status, freshness: 'fresh', sourceSnapshotHash, targetSnapshotHash, issues };
}

function findCycle(edges: EffectiveEdge[], type: GraphRelationType, includePotential = false): GraphEdge[] | undefined {
  const active = edges.filter((item) => item.edge.type === type && item.status !== 'rejected' && (includePotential || (item.status === 'confirmed' && item.freshness === 'fresh')));
  const bySource = new Map<string, GraphEdge[]>();
  for (const item of active) bySource.set(item.edge.source, [...(bySource.get(item.edge.source) ?? []), item.edge]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: GraphEdge[] = [];
  const visit = (node: string): GraphEdge[] | undefined => {
    if (visiting.has(node)) {
      const start = stack.findIndex((edge) => edge.source === node);
      return stack.slice(Math.max(0, start));
    }
    if (visited.has(node)) return undefined;
    visiting.add(node);
    for (const edge of bySource.get(node) ?? []) {
      stack.push(edge);
      const cycle = visit(edge.target);
      if (cycle) return cycle;
      stack.pop();
    }
    visiting.delete(node);
    visited.add(node);
    return undefined;
  };
  for (const node of bySource.keys()) { const cycle = visit(node); if (cycle) return cycle; }
  return undefined;
}

export function validateGraph(edges: GraphEdge[], nodes: Map<string, GraphNodeRecord>): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  const activeKeys = new Set<string>();
  const effective = edges.map((edge) => effectiveEdge(edge, nodes));
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]!;
    for (const entry of edge.confirmations) {
      const { entry_hash, ...base } = entry;
      if (entry_hash !== sha256Hex(canonicalJson(base)) || entry.edge_ref !== edge.id || entry.edge_claim_hash !== graphEdgeClaimHash(edge)) {
        issues.push({ code: 'invalid_confirmation', ref: edge.id, detail: `Confirmation ${entry.id} does not match the current Edge claim or its own hash.` });
      }
    }
    if (ids.has(edge.id)) issues.push({ code: 'duplicate_edge_id', ref: edge.id, detail: 'Edge IDs must be unique.' });
    ids.add(edge.id);
    if (!graphRelationTypeSchema.safeParse(edge.type).success) { issues.push({ code: 'unsupported_relation_type', ref: edge.id, detail: edge.type }); continue; }
    if (edge.source === edge.target) issues.push({ code: 'self_edge', ref: edge.id, detail: 'Self relationships are forbidden.' });
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) issues.push({ code: 'missing_endpoint', ref: edge.id, detail: `Node endpoint does not resolve (${edge.source}, ${edge.target}).` });
    if (source && target && !relationKindAllowed(edge.type, source.node.kind, target.node.kind)) issues.push({ code: 'invalid_kind_pair', ref: edge.id, detail: `${source.node.kind} → ${target.node.kind} is not allowed for ${edge.type}.` });
    const canonical = canonicalizeEdgeEndpoints(edge.type, edge.source, edge.target);
    if (canonical.source !== edge.source || canonical.target !== edge.target) issues.push({ code: 'noncanonical_symmetric_edge', ref: edge.id, detail: 'Symmetric endpoints must be stored in canonical ID order.' });
    const active = effective[index]!.status !== 'rejected';
    const key = `${edge.type}:${canonical.source}:${canonical.target}`;
    if (active && activeKeys.has(key)) issues.push({ code: 'duplicate_active_edge', ref: edge.id, detail: 'An active relationship with these endpoints already exists.' });
    if (active) activeKeys.add(key);
    for (const issue of effective[index]!.issues) issues.push(issue);
  }
  for (const type of acyclicRelationTypes) {
    const cycle = findCycle(effective, type);
    if (cycle) issues.push({ code: 'confirmed_cycle', ref: cycle.map((edge) => edge.id).join(','), detail: `Fresh confirmed ${type} cycle.` });
    else {
      const proposedCycle = findCycle(effective, type, true);
      if (proposedCycle) issues.push({ code: 'proposed_cycle', ref: proposedCycle.map((edge) => edge.id).join(','), detail: `Unconfirmed or stale ${type} cycle; review before confirming.` });
    }
  }
  return issues;
}

export function validateConfirmation(edge: GraphEdge, nodes: Map<string, GraphNodeRecord>, userResponse: 'agreed' | 'disagreed', userStatement: string, rationale: string, checkedAt: string) {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) throw new Error('Both current Node endpoints are required before confirmation.');
  const base = {
    id: `ECF-${String(edge.confirmations.length + 1).padStart(3, '0')}`,
    edge_ref: edge.id,
    edge_claim_hash: graphEdgeClaimHash(edge),
    endpoint_snapshot_hashes: { source: edgeSnapshotHash(source), target: edgeSnapshotHash(target) },
    user_response: userResponse,
    user_statement: userStatement.trim(),
    rationale: rationale.trim(),
    checked_at: checkedAt,
  };
  const entry_hash = sha256Hex(canonicalJson(base));
  return edgeConfirmationSchema.parse({ ...base, entry_hash });
}

export interface ImpactInput {
  seedNodeId: string;
  graphEdges: GraphEdge[];
  candidates: RelationCandidate[];
  workspace: GraphWorkspaceSnapshot;
  createdAt: string;
}

export function computeImpactReport(input: ImpactInput): ImpactReport {
  const { seedNodeId, graphEdges, candidates, workspace } = input;
  const issues = [...workspace.issues].map((issue) => ({ code: issue.code, ref: issue.ref, reason: issue.reason }));
  if (!workspace.nodes.has(seedNodeId)) throw new Error(`Unknown seed Node ${seedNodeId}.`);
  const states = graphEdges.map((edge) => effectiveEdge(edge, workspace.nodes));
  for (const state of states) for (const issue of state.issues) issues.push({ code: issue.code, ref: issue.ref, reason: issue.detail });
  for (const issue of validateGraph(graphEdges, workspace.nodes)) {
    if (!issues.some((old) => old.code === issue.code && old.ref === issue.ref && old.reason === issue.detail)) {
      issues.push({ code: issue.code, ref: issue.ref, reason: issue.detail });
    }
  }
  const activeCandidates = candidates.filter((candidate) => candidate.review_status !== 'dismissed');
  if (graphEdges.length === 0 && activeCandidates.length === 0) issues.push({ code: 'relationship_review_missing', ref: seedNodeId, reason: 'An empty Graph is structurally valid but does not prove that relationship discovery was performed.' });
  for (const candidate of activeCandidates) {
    const sourceHash = workspace.node_snapshot_hashes.get(candidate.source_node_ref);
    const targetHash = workspace.node_snapshot_hashes.get(candidate.target_node_ref);
    const stale = sourceHash !== candidate.endpoint_snapshot_hashes.source || targetHash !== candidate.endpoint_snapshot_hashes.target;
    issues.push({ code: stale ? 'stale_relation_candidate' : 'unsupported_relation_type', ref: candidate.id, reason: `${candidate.original_relation_name} is not a supported Edge type${stale ? '; endpoint evidence is stale' : ''}.` });
  }
  const confirmedImpacts: ImpactReport['confirmed_impacts'] = [];
  const potentialImpacts: ImpactReport['potential_impacts'] = [];
  const confirmedReview: ImpactReport['review_candidates']['confirmed'] = [];
  const potentialReview: ImpactReport['review_candidates']['potential'] = [];
  const queue: Array<{ node: string; certainty: 'confirmed' | 'potential'; path: NonNullable<ImpactReport['confirmed_impacts'][number]['path']> }> = [{ node: seedNodeId, certainty: 'confirmed', path: [] }];
  const visited = new Set<string>();
  const best = new Map<string, number>();
  while (queue.length) {
    const current = queue.shift()!;
    const stateKey = `${current.node}:${current.certainty}`;
    const depth = current.path.length;
    const prior = best.get(stateKey);
    if (prior !== undefined && prior <= depth) continue;
    best.set(stateKey, depth);
    if (depth > 0 && current.node !== seedNodeId && !visited.has(stateKey)) {
      const entry = {
        node_ref: current.node, certainty: current.certainty,
        effect: 'dependency_candidate' as const, depth, direct: depth === 1,
        path: current.path, warnings: current.certainty === 'potential' ? ['At least one proposed or stale relationship is in this path.'] : [],
      };
      (current.certainty === 'confirmed' ? confirmedImpacts : potentialImpacts).push(entry);
      visited.add(stateKey);
    }
    for (const state of states) {
      if (state.status === 'rejected') continue;
      const edge = state.edge;
      const sourceNode = workspace.nodes.get(edge.source);
      const targetNode = workspace.nodes.get(edge.target);
      // A malformed relationship is visible as a blocked input, but must never
      // become an impact path even as a merely potential edge.
      if (!sourceNode || !targetNode || edge.source === edge.target || !relationKindAllowed(edge.type, sourceNode.node.kind, targetNode.node.kind)) continue;
      const certainty: 'confirmed' | 'potential' = current.certainty === 'potential' || state.status !== 'confirmed' || state.freshness !== 'fresh' ? 'potential' : 'confirmed';
      const add = (to: string, traversal: 'forward' | 'reverse', reviewOnly: boolean) => {
        if (current.node !== (traversal === 'forward' ? edge.source : edge.target)) return;
        const witness = { edge_ref: edge.id, type: edge.type, from: current.node, to, traversal, basis: edge.basis, reason: edge.reason, effective_status: state.status, freshness: state.freshness };
        const path = [...current.path, witness];
        if (reviewOnly) {
          const entry = { node_ref: to, certainty, effect: 'review_candidate' as const, depth: path.length, direct: path.length === 1, path, warnings: ['Review relationship; impact is not automatically propagated.'] };
          (certainty === 'confirmed' ? confirmedReview : potentialReview).push(entry);
        } else queue.push({ node: to, certainty, path });
      };
      if (edge.type === 'depends_on') add(edge.source, 'reverse', false);
      else if (edge.type === 'exception_of') { add(edge.source, 'reverse', false); add(edge.target, 'forward', true); }
      else if (edge.type === 'precedes') add(edge.target, 'forward', true);
      else if (symmetricRelationTypes.has(edge.type)) { add(edge.target, 'forward', true); add(edge.source, 'reverse', true); }
      else if (edge.type === 'supersedes') { add(edge.target, 'forward', true); add(edge.source, 'reverse', true); }
    }
  }
  const compact = (items: ImpactReport['review_candidates']['confirmed']) => {
    const byNode = new Map<string, typeof items[number]>();
    for (const item of items) {
      const old = byNode.get(item.node_ref);
      if (!old || item.depth < old.depth || (item.depth === old.depth && canonicalJson(item.path).localeCompare(canonicalJson(old.path)) < 0)) byNode.set(item.node_ref, item);
    }
    return [...byNode.values()].sort((a, b) => a.depth - b.depth || a.node_ref.localeCompare(b.node_ref));
  };
  confirmedImpacts.sort((a, b) => a.depth - b.depth || a.node_ref.localeCompare(b.node_ref));
  potentialImpacts.sort((a, b) => a.depth - b.depth || a.node_ref.localeCompare(b.node_ref));
  // The seed is part of the identity: reports for different seed Nodes over the same
  // graph used to share one analysis_id, so only one could ever be cited.
  const fingerprint = sha256Hex(canonicalJson({ seed: seedNodeId, workspace: workspace.fingerprint, graphEdges, candidates, rules_version: 'graph-impact/1' }));
  return impactReportSchema.parse({
    schema_version: 1,
    analysis_id: `IMP-${fingerprint.slice(0, 16)}`,
    seed_node_ref: seedNodeId,
    rules_version: 'graph-impact/1',
    input_fingerprint: fingerprint,
    completeness: issues.length ? 'incomplete' : 'complete',
    confirmed_impacts: confirmedImpacts,
    potential_impacts: potentialImpacts,
    review_candidates: { confirmed: compact(confirmedReview), potential: compact(potentialReview) },
    blocked_inputs: issues.map((issue) => ({ code: issue.code, ref: issue.ref, candidate_ref: issue.code.includes('relation_candidate') || issue.code === 'unsupported_relation_type' ? issue.ref : undefined, reason: issue.reason })),
    warnings: issues.map((issue) => `${issue.code}: ${issue.reason}`),
    created_at: input.createdAt,
  });
}
