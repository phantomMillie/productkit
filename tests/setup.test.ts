import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createMemoryOutput } from '../src/cli/output.js';
import { runCli } from '../src/cli/program.js';
import { runSetup, setupAgents, type SetupOptions } from '../src/cli/commands/setup.js';
import { SKILLS_ROOT } from '../src/clarification/skills.js';
import { CliError, ExitCode } from '../src/errors.js';

let home: string;
let source: string;
const env = {} as NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'productkit-setup-'));
  source = path.join(home, 'install', 'skills', 'productkit');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), '---\nname: productkit\ndescription: test\n---\n');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const claudeLink = () => path.join(home, '.claude', 'skills', 'productkit');
const codexLink = () => path.join(home, '.codex', 'skills', 'productkit');
const opts = (extra: SetupOptions = {}): SetupOptions => ({ home, env, source, ...extra });
const exists = (p: string) => lstat(p).then(() => true, () => false);

describe('productkit setup', () => {
  it('links into existing Agent folders only, then reports already linked', async () => {
    await mkdir(path.join(home, '.claude'));
    const first = await setupAgents(opts());
    expect(first.map((e) => [e.agent, e.action])).toEqual([['claude', 'linked'], ['codex', 'skipped_no_config']]);
    expect(await readlink(claudeLink())).toBe(source);
    expect(await exists(path.join(home, '.codex'))).toBe(false);

    const second = await setupAgents(opts());
    expect(second[0]?.action).toBe('already_linked');
  });

  it('creates the folder when an Agent is named explicitly', async () => {
    const [entry] = await setupAgents(opts({ agent: 'codex' }));
    expect(entry?.action).toBe('linked');
    expect(await readlink(codexLink())).toBe(source);
  });

  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME', async () => {
    const claudeDir = path.join(home, 'custom-claude');
    const codexDir = path.join(home, 'custom-codex');
    await mkdir(claudeDir);
    await mkdir(codexDir);
    const entries = await setupAgents(opts({ env: { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir } }));
    expect(entries.map((e) => e.action)).toEqual(['linked', 'linked']);
    expect(await readlink(path.join(claudeDir, 'skills', 'productkit'))).toBe(source);
    expect(await readlink(path.join(codexDir, 'skills', 'productkit'))).toBe(source);
  });

  it('never touches a real directory, even with --force', async () => {
    await mkdir(claudeLink(), { recursive: true });
    await writeFile(path.join(claudeLink(), 'SKILL.md'), 'mine');
    for (const force of [false, true]) {
      const [entry] = await setupAgents(opts({ agent: 'claude', force }));
      expect(entry?.action).toBe('conflict');
    }
    const [removal] = await setupAgents(opts({ agent: 'claude', remove: true }));
    expect(removal?.action).toBe('conflict');
    expect(await readFile(path.join(claudeLink(), 'SKILL.md'), 'utf8')).toBe('mine');
  });

  it('replaces a foreign symlink only with --force', async () => {
    const other = path.join(home, 'other');
    await mkdir(other);
    await mkdir(path.dirname(claudeLink()), { recursive: true });
    await symlink(other, claudeLink(), 'dir');

    const [blocked] = await setupAgents(opts({ agent: 'claude' }));
    expect(blocked?.action).toBe('conflict');
    expect(await readlink(claudeLink())).toBe(other);

    const [removal] = await setupAgents(opts({ agent: 'claude', remove: true }));
    expect(removal?.action).toBe('conflict');
    expect(await readlink(claudeLink())).toBe(other);

    const [forced] = await setupAgents(opts({ agent: 'claude', force: true }));
    expect(forced?.action).toBe('replaced');
    expect(await readlink(claudeLink())).toBe(source);
  });

  it('removes only its own link', async () => {
    await mkdir(path.join(home, '.claude'));
    await setupAgents(opts());
    const [removed] = await setupAgents(opts({ remove: true }));
    expect(removed?.action).toBe('removed');
    expect(await exists(claudeLink())).toBe(false);
    const [again] = await setupAgents(opts({ remove: true }));
    expect(again?.action).toBe('not_linked');
  });

  it('--dry-run writes nothing', async () => {
    await mkdir(path.join(home, '.claude'));
    const [planned] = await setupAgents(opts({ dryRun: true }));
    expect(planned?.action).toBe('linked');
    expect(planned?.dryRun).toBe(true);
    expect(await exists(claudeLink())).toBe(false);
    const output = createMemoryOutput();
    await runSetup(opts({ dryRun: true }), output);
    expect(output.stdout.join('\n')).toContain('would link');
    expect(await exists(claudeLink())).toBe(false);
  });

  it('runSetup exits 1 on conflict and says when no Agent folder exists', async () => {
    const none = createMemoryOutput();
    await runSetup(opts(), none);
    expect(none.stdout.join('\n')).toContain('No Claude Code or Codex config folder found');

    await mkdir(claudeLink(), { recursive: true });
    const error = await runSetup(opts({ agent: 'claude' }), createMemoryOutput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.GATE_BLOCKED);
  });

  it('defaults to the installed entry Skill and rejects an unknown agent', async () => {
    const [entry] = await setupAgents({ home, env, agent: 'claude', dryRun: true });
    expect(entry?.source).toBe(path.join(SKILLS_ROOT, 'productkit'));
    const output = createMemoryOutput();
    expect(await runCli(['setup', '--agent', 'cursor'], output)).toBe(ExitCode.USAGE_OR_IO);
    expect(output.stderr.join('\n')).toContain('Unknown agent');
  });
});
