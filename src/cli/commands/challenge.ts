import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Command } from 'commander';
import { CliError, ExitCode } from '../../errors.js';
import { ensureWorkspace, markStage } from '../../clarification/workspace.js';
import { addFinding, confirmFinding, readFindings, validateFindingReferences } from '../../clarification/finding-store.js';
import { createChallengeRun, describeInputDrift, readChallengeRuns, refreshChallengeRun, STALE_REVIEW_HINT, updateChallengeRun, validateChallengeRunReferences } from '../../clarification/challenge-store.js';
import { challengeAreaSchema, challengeAreaResultSchema, judgeChallengeCompletion } from '../../schema/challenge.js';
import { findingInputSchema } from '../../schema/finding.js';
import type { Output } from '../output.js';

function requireText(value: string | undefined, name: string): string { if (!value?.trim()) throw new CliError(`${name} is required.`, ExitCode.USAGE_OR_IO); return value.trim(); }
export function registerChallengeCommand(program: Command, output: Output): void {
  const command = program.command('challenge').description('record and validate semantic requirement review (no LLM invocation)');
  command.action(async () => {
    output.out('Challenge reviews requirements semantically using the installed Agent Skill.');
    output.out('Read skills/challenge/SKILL.md, perform the review, then record Findings and coverage.');
    output.out('The CLI validates structure and freshness only; it does not establish semantic correctness.');
  });
  command.command('review-start').description('create or reuse a review checkpoint for current inputs').action(async () => {
    const root = path.join(process.cwd(), 'product'); await ensureWorkspace(root); const run = await createChallengeRun(root);
    output.out(`Review ${run.id}: ${run.status}; ${run.inputs.length} input(s), ${run.scope.included.length} scope item(s).`);
  });
  command.command('review-resume').argument('<id>').description('resume only a current-input review checkpoint').action(async (id: string) => {
    const root = path.join(process.cwd(), 'product'); await ensureWorkspace(root); const run = (await readChallengeRuns(root)).find((r) => r.id === id);
    if (!run) throw new CliError(`Review ${id} not found.`, ExitCode.USAGE_OR_IO);
    const checked = await refreshChallengeRun(root, run); if (checked.stale) { await updateChallengeRun(root, id, (r) => ({ ...r, status: 'stale', history: [...r.history, { event: 'invalidated', at: new Date().toISOString(), statement: 'Input fingerprint changed; checkpoint cannot resume.', content_hash: r.review_hash }] })); throw new CliError(`Review ${id} is stale; create a new review.`, ExitCode.GATE_BLOCKED, [...(await describeInputDrift(root, run)), STALE_REVIEW_HINT]); }
    output.out(`Review ${id} resumed at its saved checkpoint. Status: ${run.status}.`);
  });
  command.command('review-area').argument('<id>').argument('<area>').requiredOption('--status <status>', 'reviewed, not_applicable, or not_reviewed').option('--rationale <text>').option('--evidence <kind:ref...>', 'typed evidence reference', (value: string, prior: string[] = []) => [...prior, value], [] as string[]).description('checkpoint a review area').action(async (id: string, area: string, opts: { status: string; rationale?: string; evidence: string[] }) => {
    const parsedArea = challengeAreaSchema.parse(area); const result = challengeAreaResultSchema.parse({ status: opts.status, ...(opts.rationale ? { rationale: opts.rationale } : {}), evidence_refs: opts.evidence.map((value) => { const [kind, ...rest] = value.split(':'); return { kind, ref: rest.join(':') }; }) });
    const root = path.join(process.cwd(), 'product'); const runs = await readChallengeRuns(root); if (!runs.some((r) => r.id === id)) throw new CliError(`Review ${id} not found.`, ExitCode.USAGE_OR_IO);
    const checkpoint = runs.find((r) => r.id === id)!; if ((await refreshChallengeRun(root, checkpoint)).stale || checkpoint.status === 'stale') throw new CliError('Stale review cannot be resumed; create a new review.', ExitCode.GATE_BLOCKED, [...(await describeInputDrift(root, checkpoint)), STALE_REVIEW_HINT]);
    const updated = await updateChallengeRun(root, id, (r) => ({ ...r, status: 'in_progress', areas: { ...r.areas, [parsedArea]: result }, history: [...r.history, { event: 'checkpointed', at: new Date().toISOString(), statement: `Recorded ${parsedArea}: ${result.status}.`, content_hash: r.review_hash }] }));
    output.out(`Review ${id} checkpointed: ${parsedArea}=${result.status}.`);
  });
  command.command('review-complete').argument('<id>').description('finish recorded review coverage without resolving Findings').action(async (id: string) => {
    const root = path.join(process.cwd(), 'product'); await ensureWorkspace(root); const run = (await readChallengeRuns(root)).find((r) => r.id === id);
    if (!run) throw new CliError(`Review ${id} not found.`, ExitCode.USAGE_OR_IO);
    const fresh = await refreshChallengeRun(root, run); if (fresh.stale) throw new CliError('Review inputs changed; start a new review.', ExitCode.GATE_BLOCKED, [...(await describeInputDrift(root, run)), STALE_REVIEW_HINT]);
    const status = judgeChallengeCompletion(run);
    if (status !== 'complete') throw new CliError('Review coverage is incomplete; record every area and explain unavailable inputs.', ExitCode.GATE_BLOCKED);
    const updated = await updateChallengeRun(root, id, (r) => ({ ...r, status: 'complete', history: [...r.history, { event: 'completed', at: new Date().toISOString(), statement: 'All required review areas have recorded coverage. This is not semantic correctness or product approval.', content_hash: r.review_hash }] }));
    await markStage(root, 'challenge', 'done');
    output.out(`Review ${updated.id}: COMPLETE coverage. ${updated.finding_refs.length} Finding(s) remain separately reviewable; no Finding was resolved.`);
  });
  command.command('review-validate').option('--review <id>').description('validate Finding and review structure/freshness').action(async (opts: { review?: string }) => {
    const root = path.join(process.cwd(), 'product'); await ensureWorkspace(root); const findings = await readFindings(root); const runs = await readChallengeRuns(root); const selected = opts.review ? runs.filter((r) => r.id === opts.review) : runs.slice(-1);
    let issues = 0;
    for (const finding of findings) { const missing = await validateFindingReferences(root, finding); if (missing.length) { issues++; output.out(`Finding ${finding.id}: unresolved ${missing.join(', ')}`); } if (finding.severity === 'critical' && finding.resolution_status === 'unresolved') output.out(`OPEN CRITICAL: ${finding.id} (${finding.review_status}); remains active.`); }
    for (const run of selected) { const missing = await validateChallengeRunReferences(root, run); const fresh = await refreshChallengeRun(root, run); const status = fresh.stale ? 'stale' : judgeChallengeCompletion(run); if (missing.length) { issues++; output.out(`Review ${run.id}: unresolved references ${missing.join(', ')}`); } if (fresh.stale && run.status !== 'stale') await updateChallengeRun(root, run.id, (r) => ({ ...r, status: 'stale', history: [...r.history, { event: 'invalidated', at: new Date().toISOString(), statement: 'Current input fingerprint differs from the saved review.', content_hash: r.review_hash }] })); if (fresh.stale) issues++; output.out(`Review ${run.id}: ${status.toUpperCase()}${fresh.stale ? ' (inputs changed)' : ''}; coverage only, not semantic correctness or product approval.`); if (status === 'incomplete') issues++; }
    if (issues) throw new CliError(`Challenge structural validation found ${issues} issue(s).`, ExitCode.GATE_BLOCKED);
    output.out('Challenge structural validation: PASS. User statement authenticity and semantic completeness are not proven.');
  });
  const finding = command.command('finding').description('manage semantic Finding records');
  finding.command('add').requiredOption('--input <yaml>').description('store AI Finding as proposed/unresolved').action(async (opts: { input: string }) => {
    const root = path.join(process.cwd(), 'product'); await ensureWorkspace(root); const value = findingInputSchema.parse(parseYaml(await readFile(path.resolve(opts.input), 'utf8'))); const result = await addFinding(root, value);
    output.out(`${result.created ? 'Created' : 'Existing'} Finding ${result.finding.id}: proposed / unresolved.`);
  });
  finding.command('confirm').argument('<id>').requiredOption('--response <response>').requiredOption('--user-statement <text>').requiredOption('--rationale <text>').description('append explicit user confirmation or rejection').action(async (id: string, opts: { response: string; userStatement: string; rationale: string }) => {
    if (opts.response !== 'confirmed' && opts.response !== 'rejected') throw new CliError('Response must be confirmed or rejected.', ExitCode.USAGE_OR_IO);
    const updated = await confirmFinding(path.join(process.cwd(), 'product'), id, opts.response, requireText(opts.userStatement, '--user-statement'), requireText(opts.rationale, '--rationale'));
    output.out(`Finding ${id}: ${updated.review_status}; current content hash and entry hash are structurally valid.`);
    output.out('The CLI cannot verify the speaker identity or truth of the recorded user statement.');
  });
}
