// Links the productkit entry Skill into Claude Code / Codex after a global
// install, so an Agent knows ProductKit exists without an extra step.
//
// - Only for `npm install -g`: a project dependency install never writes to
//   the user's home folder.
// - Only Agents whose config folder already exists (see `productkit setup`).
// - Never fails the install. PRODUCTKIT_SKIP_SETUP=1 turns it off.
// - Runs before `prepare` in a repository checkout, so dist/ may not exist yet.

if (process.env.npm_config_global !== 'true' || process.env.PRODUCTKIT_SKIP_SETUP === '1') {
  process.exit(0);
}

try {
  const { setupAgents, formatSetupEntry } = await import('../dist/cli/commands/setup.js');
  const entries = await setupAgents({ agent: 'all' });
  for (const entry of entries) console.log(`productkit: ${formatSetupEntry(entry)}`);
  if (entries.some((entry) => entry.action === 'conflict' || entry.action === 'error')) {
    console.log('productkit: some links were left unchanged. Run "productkit setup" to see why.');
  }
} catch (cause) {
  const reason = cause instanceof Error ? cause.message : String(cause);
  console.log(`productkit: Skill linking skipped (${reason}). Run "productkit setup" after install.`);
}
process.exit(0);
