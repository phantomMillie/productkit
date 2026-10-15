import { Command, CommanderError } from 'commander';

import { CliError, ExitCode, describeCause, type ExitCodeValue } from '../errors.js';
import { VERSION } from '../version.js';
import { runClarify } from './commands/clarify.js';
import { runInit } from './commands/init.js';
import { runIntake } from './commands/intake.js';
import { runModel } from './commands/model.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerChallengeCommand } from './commands/challenge.js';
import { registerProposalDecisionCommands } from './commands/proposal-decision.js';
import { registerDefinitionCommand } from './commands/definition.js';
import { registerValidationCommands } from './commands/validation.js';
import { registerExportCommand } from './commands/export.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerComputeCommand } from './commands/compute.js';
import { consoleOutput, type Output } from './output.js';

const DESCRIPTION = [
  'Turn a natural-language product idea into a traceable Product Definition.',
  '',
  'ProductKit never calls an LLM. It manages files, schemas and validation;',
  'Claude Code or Codex handles the conversation and the reasoning.',
  '',
  'Implemented in this release: setup, init, intake, clarify, model, graph, challenge, propose, decide, assumption, migrate, define, validate, approve, export openspec and compute.',
].join('\n');

/**
 * Builds the Commander program.
 *
 * Only implemented commands are registered. A placeholder that accepts input
 * and reports success would misrepresent what the tool can do.
 */
export function buildProgram(output: Output = consoleOutput): Command {
  const program = new Command();

  program
    .name('productkit')
    .description(DESCRIPTION)
    .version(VERSION, '-V, --version', 'print the installed ProductKit version')
    .showHelpAfterError('(run "productkit --help" for usage)')
    .configureOutput({
      // Route Commander's own output through the injected sink so tests can
      // read help text instead of scraping the real stdio.
      writeOut: (str) => output.out(str.replace(/\n$/, '')),
      writeErr: (str) => output.err(str.replace(/\n$/, '')),
    })
    .exitOverride();

  program
    .command('init')
    .argument('[path]', 'target directory (defaults to the current directory)')
    .description('create the product/ workspace in a target app')
    .option('--name <name>', 'product name written into config.yaml')
    .option('--dry-run', 'report what would be created without writing anything')
    .exitOverride()
    .action(async (targetPath: string | undefined, opts: { name?: string; dryRun?: boolean }) => {
      await runInit(
        { targetPath, name: opts.name, dryRun: opts.dryRun ?? false },
        output,
      );
    });

  program
    .command('intake')
    .argument('[text]', 'prompt text (omit when using --file)')
    .description('save a prompt as the input to Clarification')
    .option('--file <path>', 'read the prompt text from a file instead')
    .exitOverride()
    .action(async (text: string | undefined, opts: { file?: string }) => {
      await runIntake({ text, file: opts.file }, output);
    });

  program
    .command('clarify')
    .description('report Clarification status, or announce the instruction to run it')
    .option('--prompt <id>', 'target a specific prompt (defaults to the latest)')
    .addHelpText(
      'after',
      '\n' +
        'This works the same whether or not an Agent auto-selects a skill for it:\n' +
        'the Agent runs this command directly and reads the instruction path it prints.\n' +
        'So that Claude Code / Codex offer ProductKit when you describe an idea, run\n' +
        '"productkit setup" once (a global npm install does it for you). It links the\n' +
        'productkit entry Skill into your user Skill folder; "productkit init" still\n' +
        'never writes outside product/.',
    )
    .exitOverride()
    .action(async (opts: { prompt?: string }) => {
      await runClarify({ prompt: opts.prompt }, output);
    });

  program
    .command('model')
    .description('report Node modeling status, or announce the instruction to run it')
    .option('--clarification <id>', 'target a specific Clarification (defaults to the latest)')
    .exitOverride()
    .action(async (opts: { clarification?: string }) => {
      await runModel({ clarification: opts.clarification }, output);
    });

  registerGraphCommand(program, output);
  registerMigrateCommand(program, output);
  registerChallengeCommand(program, output);
  registerProposalDecisionCommands(program, output);
  registerDefinitionCommand(program, output);
  registerValidationCommands(program, output);
  registerExportCommand(program, output);
  registerSetupCommand(program, output);
  registerComputeCommand(program, output);

  return program;
}

/**
 * Parses argv and runs the matching command.
 *
 * Returns an exit code instead of calling process.exit so tests can drive the
 * CLI in-process.
 */
export async function runCli(
  argv: string[],
  output: Output = consoleOutput,
): Promise<ExitCodeValue> {
  const program = buildProgram(output);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return ExitCode.OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version are delivered as throws; they are not failures.
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.help') {
        return ExitCode.OK;
      }
      if (error.code === 'commander.version') {
        return ExitCode.OK;
      }
      // Everything else from Commander is a usage problem.
      return ExitCode.USAGE_OR_IO;
    }

    if (error instanceof CliError) {
      output.err(`error: ${error.message}`);
      for (const line of error.details) {
        output.err(line);
      }
      return error.exitCode;
    }

    output.err(`error: ${describeCause(error)}`);
    return ExitCode.USAGE_OR_IO;
  }
}
