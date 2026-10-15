import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

import { runCli } from '../src/cli/program.js';
import { ExitCode } from '../src/errors.js';
import { VERSION } from '../src/version.js';
import { createMemoryOutput } from '../src/cli/output.js';

const require = createRequire(import.meta.url);

describe('exit code contract', () => {
  it('fixes the three documented codes', () => {
    expect(ExitCode.OK).toBe(0);
    expect(ExitCode.GATE_BLOCKED).toBe(1);
    expect(ExitCode.USAGE_OR_IO).toBe(2);
  });
});

describe('version', () => {
  it('matches package.json', () => {
    const pkg = require('../package.json') as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('--version prints the version and exits 0', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['--version'], output)).toBe(ExitCode.OK);
    expect(output.stdout.join('\n')).toContain(VERSION);
  });
});

describe('help', () => {
  it('--help lists the implemented commands and exits 0', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['--help'], output)).toBe(ExitCode.OK);
    const text = output.stdout.join('\n');
    expect(text).toContain('productkit');
    expect(text).toContain('init');
  });

  it('init --help describes the argument and options', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['init', '--help'], output)).toBe(ExitCode.OK);
    const text = output.stdout.join('\n');
    expect(text).toContain('[path]');
    expect(text).toContain('--name');
    expect(text).toContain('--dry-run');
  });

  it('intake --help describes the argument and --file option', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['intake', '--help'], output)).toBe(ExitCode.OK);
    const text = output.stdout.join('\n');
    expect(text).toContain('[text]');
    expect(text).toContain('--file');
  });

  it('clarify --help points to productkit setup, without writing anything', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['clarify', '--help'], output)).toBe(ExitCode.OK);
    const text = output.stdout.join('\n');
    expect(text).toContain('productkit setup');
    expect(text).toContain('never writes outside product/');
  });
});

describe('usage errors', () => {
  it('an unknown command exits 2 and explains itself', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['nope'], output)).toBe(ExitCode.USAGE_OR_IO);
    expect(output.stderr.join('\n')).toContain("unknown command 'nope'");
  });

  it('an unknown option exits 2', async () => {
    const output = createMemoryOutput();
    expect(await runCli(['init', '--force'], output)).toBe(ExitCode.USAGE_OR_IO);
  });
});

describe('unimplemented stages', () => {
  const stages = ['ingest', 'discover', 'review'];

  it('are not registered as commands', async () => {
    for (const stage of stages) {
      const output = createMemoryOutput();
      expect(await runCli([stage], output), `${stage} must not be a command`).toBe(
        ExitCode.USAGE_OR_IO,
      );
    }
  });

  it('do not appear in the command list', async () => {
    const output = createMemoryOutput();
    await runCli(['--help'], output);
    const commandList = output.stdout.join('\n').split('Commands:')[1] ?? '';
    for (const stage of stages) {
      expect(commandList, `${stage} must not be advertised`).not.toMatch(
        new RegExp(`^\\s+${stage}\\b`, 'm'),
      );
    }
  });
});

describe('Proposal and Decision command registration', () => {
  it('advertises explicit Proposal/Decision commands and requires a recorded user statement', async () => {
    const help=createMemoryOutput();
    expect(await runCli(['--help'],help)).toBe(ExitCode.OK);
    expect(help.stdout.join('\n')).toMatch(/^\s+propose\b/m);
    expect(help.stdout.join('\n')).toMatch(/^\s+decide\b/m);
    for(const args of [['decide','record','--input','decision.yaml'],['decide','record','--input','decision.yaml','--user-statement','I choose A.'],['decide','record','--input','decision.yaml','--user-statement','I choose A.','--rationale','Reason.']]){
      const missing=createMemoryOutput();
      expect(await runCli(args,missing)).toBe(ExitCode.USAGE_OR_IO);
    }
  });
});
