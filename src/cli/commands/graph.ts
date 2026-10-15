import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Command } from 'commander';
import { CliError, ExitCode, describeCause } from '../../errors.js';
import { atomicCreateFile } from '../../clarification/io.js';
import { loadGraphWorkspace, graphNodeSnapshotHash } from '../../clarification/provenance.js';
import { canonicalizeEdgeEndpoints, computeImpactReport, effectiveEdge, validateGraph, validateConfirmation } from '../../clarification/graph.js';
import { addRelationCandidate, readGraphDocument, readRelationCandidates, reviewRelationCandidate, updateGraphDocument } from '../../clarification/graph-store.js';
import { graphEdgeSchema, relationCandidateSchema, graphRelationTypeSchema } from '../../schema/graph.js';
import { parseImpactReport } from '../../schema/impact.js';
import { ensureWorkspace, markStage } from '../../clarification/workspace.js';
import { parseProductConfig } from '../../schema/config.js';
import { SKILLS_ROOT } from '../../clarification/skills.js';
import { canonicalJson } from '../../clarification/hash.js';
import type { Output } from '../output.js';

interface GraphBaseOptions { cwd?: string }
const meaningfulInput = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

async function requireV1(root: string): Promise<void> {
  await ensureWorkspace(root);
  const config = parseProductConfig(await readFile(path.join(root, 'config.yaml'), 'utf8'));
  if (config.schema_version !== 1) throw new CliError('Graph commands require workspace schema_version 1. Run "productkit migrate" first.', ExitCode.USAGE_OR_IO);
}

function logIssue(output: Output, issue: { code: string; ref: string; detail: string }): void {
  output.out(`  ${issue.code}: ${issue.ref} — ${issue.detail}`);
}

export async function runGraphValidate(options: GraphBaseOptions, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  const { graph } = await readGraphDocument(root);
  const candidates = await readRelationCandidates(root);
  const issues = [
    ...validateGraph(graph.edges, workspace.nodes).filter((item) => item.code !== 'proposed_cycle').map((item) => ({ code: item.code, ref: item.ref, detail: item.detail })),
    ...workspace.issues.map((item) => ({ code: item.code, ref: item.ref, detail: item.reason })),
  ];
  for (const warning of validateGraph(graph.edges, workspace.nodes).filter((item) => item.code === 'proposed_cycle')) output.out(`  WARN ${warning.code}: ${warning.ref} — ${warning.detail}`);
  for (const candidate of candidates) {
    if (candidate.review_status === 'dismissed') continue;
    const source = workspace.node_snapshot_hashes.get(candidate.source_node_ref);
    const target = workspace.node_snapshot_hashes.get(candidate.target_node_ref);
    const stale = source !== candidate.endpoint_snapshot_hashes.source || target !== candidate.endpoint_snapshot_hashes.target;
    issues.push({ code: stale ? 'stale_relation_candidate' : 'unsupported_relation_type', ref: candidate.id, detail: `${candidate.original_relation_name} remains a non-Edge candidate${stale ? ' with changed endpoint evidence' : ''}.` });
  }
  if (issues.length) {
    output.out(`Graph validation: INCOMPLETE (${issues.length} issue(s))`);
    for (const issue of issues) logIssue(output, issue);
    output.out('Structural result only; this does not establish semantic correctness or user approval.');
    throw new CliError('Graph validation is incomplete.', ExitCode.GATE_BLOCKED);
  }
  output.out(`Graph validation: PASS (${graph.edges.length} Edge(s), ${candidates.length} Candidate(s))`);
  output.out('Structural result only; this does not establish semantic correctness or user approval.');
}

export async function runGraphImpact(options: GraphBaseOptions & { node: string; outputPath?: string; checkReport?: string }, output: Output): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const root = path.join(cwd, 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  const { graph } = await readGraphDocument(root);
  const candidates = await readRelationCandidates(root);
  const report = computeImpactReport({ seedNodeId: options.node, graphEdges: graph.edges, candidates, workspace, createdAt: new Date().toISOString() });
  if (options.checkReport) {
    const old = parseImpactReport(await readFile(path.resolve(cwd, options.checkReport), 'utf8'));
    const { created_at: _oldCreated, ...oldBody } = old;
    const { created_at: _newCreated, ...newBody } = report;
    if (canonicalJson(oldBody) !== canonicalJson(newBody)) throw new CliError(`Impact report STALE or modified: ${options.checkReport}`, ExitCode.GATE_BLOCKED);
    output.out(`Impact report latest: ${old.analysis_id}`);
  } else if (options.outputPath) {
    const destination = path.resolve(cwd, options.outputPath);
    const graphRoot = path.resolve(root, 'graph') + path.sep;
    if (!destination.startsWith(graphRoot)) throw new CliError('Impact reports may only be written under product/graph/.', ExitCode.USAGE_OR_IO);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!(await atomicCreateFile(destination, stringifyYaml(report)))) throw new CliError(`Impact report already exists: ${destination}`, ExitCode.USAGE_OR_IO);
    output.out(`Impact report saved: ${path.relative(cwd, destination)}`);
  }
  output.out(JSON.stringify(report, null, 2));
  if (report.completeness === 'incomplete') {
    await markGraphStage(root, 'in_progress');
    throw new CliError('Impact result is incomplete; review blocked_inputs and warnings.', ExitCode.GATE_BLOCKED);
  }
  await markGraphStage(root, 'done');
}

async function markGraphStage(productRoot: string, status: 'in_progress' | 'done'): Promise<void> {
  const config = parseProductConfig(await readFile(path.join(productRoot, 'config.yaml'), 'utf8'));
  if (config.schema_version === 1) await markStage(productRoot, 'graph_analysis', status);
}

export async function runGraphTrace(options: GraphBaseOptions & { node: string }, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  const record = workspace.nodes.get(options.node);
  if (!record) throw new CliError(`Node ${options.node} does not resolve to a current modeled Node.`, ExitCode.GATE_BLOCKED);
  output.out(JSON.stringify({ node_ref: options.node, node: record.node, node_group_ref: record.node_group_ref, clarification_ref: record.clarification_ref, prompt_ref: record.prompt_ref, endpoint_snapshot_hash: graphNodeSnapshotHash(record) }, null, 2));
}

export async function runGraphCandidateAdd(options: GraphBaseOptions & { input: string }, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const inputText = await readFile(path.resolve(options.cwd ?? process.cwd(), options.input), 'utf8');
  const value = parseYaml(inputText) as Record<string, unknown>;
  const evidence = value.evidence_refs;
  if (!Array.isArray(evidence) || !evidence.every((entry) => entry && typeof entry === 'object' && meaningfulInput((entry as { ref?: unknown }).ref) && ['prompt', 'span', 'clarification', 'node'].includes(String((entry as { kind?: unknown }).kind)))) {
    throw new CliError('Candidate input requires evidence_refs with kind and ref.', ExitCode.GATE_BLOCKED);
  }
  if (!meaningfulInput(value.original_relation_name) || !meaningfulInput(value.source_node_ref) || !meaningfulInput(value.target_node_ref) || !meaningfulInput(value.proposed_meaning)) throw new CliError('Candidate input is missing a required field.', ExitCode.GATE_BLOCKED);
  if (graphRelationTypeSchema.safeParse(value.original_relation_name).success) throw new CliError('Supported relations must be proposed as Graph Edges, not RelationCandidates.', ExitCode.GATE_BLOCKED);
  const result = await addRelationCandidate(root, {
    original_relation_name: value.original_relation_name,
    source_node_ref: value.source_node_ref,
    target_node_ref: value.target_node_ref,
    proposed_meaning: value.proposed_meaning,
    evidence_refs: evidence as Array<{ ref: string; kind: 'prompt' | 'span' | 'clarification' | 'node' }>,
  });
  output.out(`RelationCandidate ${result.created ? 'saved' : 'already exists'}: ${result.candidate.id}`);
  output.out(`  relation: ${result.candidate.original_relation_name}`);
  output.out('  review_status: pending (not an Edge or approval)');
}

export async function runGraphCandidateList(options: GraphBaseOptions, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  const candidates = await readRelationCandidates(root);
  if (!candidates.length) { output.out('No RelationCandidates.'); return; }
  for (const candidate of candidates) {
    const stale = workspace.node_snapshot_hashes.get(candidate.source_node_ref) !== candidate.endpoint_snapshot_hashes.source || workspace.node_snapshot_hashes.get(candidate.target_node_ref) !== candidate.endpoint_snapshot_hashes.target;
    output.out(`${candidate.id} ${candidate.original_relation_name} ${candidate.review_status}${stale ? ' STALE' : ''} ${candidate.source_node_ref} -> ${candidate.target_node_ref}`);
  }
  output.out('Review status does not create or confirm a Graph Edge.');
}

export async function runGraphCandidateReview(options: GraphBaseOptions & { id: string; status: 'reviewed' | 'dismissed'; statement: string; rationale: string }, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const candidate = await reviewRelationCandidate(root, options.id, options.status, options.statement, options.rationale);
  output.out(`RelationCandidate ${candidate.id} review status: ${candidate.review_status}`);
  output.out('This records review only; it never confirms or creates a Graph Edge.');
}

export async function runGraphEdgeAdd(options: GraphBaseOptions & { input: string }, output: Output): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const root = path.join(cwd, 'product');
  await requireV1(root);
  const parsed = graphEdgeSchema.parse(parseYaml(await readFile(path.resolve(cwd, options.input), 'utf8')));
  if (parsed.status !== 'proposed' || parsed.confirmations.length) throw new CliError('AI-created Edge must start proposed with no confirmation records.', ExitCode.GATE_BLOCKED);
  // conflicts_with / duplicates have no direction, so storing them in canonical
  // ID order changes nothing semantically; do it here instead of rejecting.
  const edge = { ...parsed, ...canonicalizeEdgeEndpoints(parsed.type, parsed.source, parsed.target) };
  const swapped = edge.source !== parsed.source;
  const workspace = await loadGraphWorkspace(root);
  const result = await updateGraphDocument(root, (graph) => {
    const next = { ...graph, edges: [...graph.edges, edge] };
    const errors = validateGraph(next.edges, workspace.nodes).filter((issue) => !['proposed_cycle'].includes(issue.code));
    if (errors.length) throw new CliError(`Edge rejected: ${errors.map((issue) => issue.code).join(', ')}`, ExitCode.GATE_BLOCKED, errors.map((issue) => `${issue.ref}: ${issue.detail}`));
    return next;
  });
  output.out(`Graph Edge proposed: ${edge.id} (${result.edges.length} total)`);
  if (swapped) output.out(`  ${edge.type} is symmetric; stored as ${edge.source} -> ${edge.target} (canonical ID order).`);
}

export async function runGraphEdgeConfirm(options: GraphBaseOptions & { id: string; response: 'agreed' | 'disagreed'; statement: string; rationale: string }, output: Output): Promise<void> {
  const root = path.join(options.cwd ?? process.cwd(), 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  await updateGraphDocument(root, (graph) => {
    const index = graph.edges.findIndex((edge) => edge.id === options.id);
    if (index < 0) throw new CliError(`Unknown Edge ${options.id}.`, ExitCode.USAGE_OR_IO);
    const edge = graph.edges[index]!;
    const confirmation = validateConfirmation(edge, workspace.nodes, options.response, options.statement, options.rationale, new Date().toISOString());
    const updated = { ...edge, status: options.response === 'agreed' ? 'confirmed' as const : 'rejected' as const, confirmations: [...edge.confirmations, confirmation] };
    const nextEdges = [...graph.edges]; nextEdges[index] = updated;
    const issues = validateGraph(nextEdges, workspace.nodes).filter((issue) => issue.code === 'confirmed_cycle' || issue.code === 'invalid_confirmation' || issue.code === 'missing_endpoint' || issue.code === 'invalid_kind_pair' || issue.code === 'self_edge');
    if (issues.length) throw new CliError(`Edge confirmation rejected: ${issues.map((issue) => issue.code).join(', ')}`, ExitCode.GATE_BLOCKED, issues.map((issue) => issue.detail));
    return { ...graph, edges: nextEdges };
  });
  output.out(`Edge ${options.id} ${options.response === 'agreed' ? 'confirmed' : 'rejected'} with explicit recorded user input.`);
  output.out('The CLI validates record structure and hashes; it cannot prove who made the statement.');
}

export async function runGraphStatus(options: GraphBaseOptions, output: Output): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const root = path.join(cwd, 'product');
  await requireV1(root);
  const workspace = await loadGraphWorkspace(root);
  const { graph } = await readGraphDocument(root);
  const candidates = await readRelationCandidates(root);
  const issues = validateGraph(graph.edges, workspace.nodes);
  output.out(`Graph: ${graph.edges.length} Edge(s), ${candidates.length} RelationCandidate(s)`);
  for (const state of graph.edges.map((edge) => effectiveEdge(edge, workspace.nodes))) output.out(`  ${state.edge.id}: ${state.status}/${state.freshness} ${state.edge.type} ${state.edge.source} -> ${state.edge.target}`);
  if (issues.length) for (const issue of issues) logIssue(output, issue);
  output.out(`Instruction: ${path.join(SKILLS_ROOT, 'graph', 'SKILL.md')}`);
}

export function registerGraphCommand(program: Command, output: Output): void {
  const graph = program.command('graph').description('validate typed relationships and analyze change impact');
  graph.action(async () => runGraphStatus({}, output));
  graph.command('validate').description('validate Graph and Candidate structure').action(async () => runGraphValidate({}, output));
  graph.command('impact').description('calculate confirmed and potential impact candidates').requiredOption('--node <id>').option('--output <path>').option('--check-report <path>').action(async (opts: { node: string; output?: string; checkReport?: string }) => runGraphImpact({ node: opts.node, ...(opts.output ? { outputPath: opts.output } : {}), ...(opts.checkReport ? { checkReport: opts.checkReport } : {}) }, output));
  graph.command('trace').description('trace current Prompt to Node provenance').requiredOption('--node <id>').action(async (opts: { node: string }) => runGraphTrace({ node: opts.node }, output));
  const edge = graph.command('edge').description('create or confirm a supported Graph Edge');
  edge.command('add').requiredOption('--input <yaml>').action(async (opts: { input: string }) => runGraphEdgeAdd(opts, output));
  edge.command('confirm').argument('<id>').requiredOption('--response <agreed|disagreed>').requiredOption('--user-statement <text>').requiredOption('--rationale <text>').action(async (id: string, opts: { response: 'agreed' | 'disagreed'; userStatement: string; rationale: string }) => runGraphEdgeConfirm({ id, response: opts.response, statement: opts.userStatement, rationale: opts.rationale }, output));
  const candidate = graph.command('candidate').description('preserve unsupported relation hypotheses separately from Edges');
  candidate.command('add').requiredOption('--input <yaml>').action(async (opts: { input: string }) => runGraphCandidateAdd(opts, output));
  candidate.command('list').action(async () => runGraphCandidateList({}, output));
  candidate.command('review').argument('<id>').requiredOption('--status <reviewed|dismissed>').requiredOption('--user-statement <text>').requiredOption('--rationale <text>').action(async (id: string, opts: { status: 'reviewed' | 'dismissed'; userStatement: string; rationale: string }) => runGraphCandidateReview({ id, status: opts.status, statement: opts.userStatement, rationale: opts.rationale }, output));
}
