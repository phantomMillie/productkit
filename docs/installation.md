# ProductKit beta installation

This guide installs the same immutable ProductKit Git tag in personal and company development environments. Do not put a token or password in the URL.

## Access and prerequisites

- Node.js 20.19 or newer and npm.
- Git, with access to the GitHub repository. The repository is public; if you use a private fork, authenticate with an approved method such as Git Credential Manager, `gh` authentication, or the company's approved SSH agent.
- Claude Code or Codex installed and authenticated according to the user's own organization policy.

Company users must use the company-approved GitHub identity, repository access route, and AI tools. Never copy personal GitHub tokens, SSH private keys, Claude credentials, Codex credentials, or local `.env`, `.npmrc`, `.claude/settings.local.json`, `.aws`, or `.ssh` data between environments. Do not embed credentials in Git URLs or shell history.

## Install an exact release tag

Authenticate to GitHub with the approved method, then install the tag:

```sh
npm install --global "git+https://github.com/gilgim/productkit.git#v0.1.0-beta.1"
productkit --version
```

The expected version output is `0.1.0-beta.1`. The package's `prepare` script compiles TypeScript during npm's Git dependency packaging step; the installed package contains the compiled CLI and Skills, but not development dependencies. The Git install requires npm and Git to be able to access the repository.

To update, install the next approved tag explicitly using the same command and replace the tag. To roll back, install a previously approved tag the same way. Avoid an unpinned branch URL for repeatable environments.

## Connect Agent Skills

A global install links one entry Skill, `productkit`, into the user Skill folder of each Agent you already have:

| Agent | Link |
|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/productkit`, or `~/.claude/skills/productkit` |
| Codex | `$CODEX_HOME/skills/productkit`, or `~/.codex/skills/productkit` |

With that link in place, describe a new product or feature idea to the Agent. If the repository already has a `product/` workspace, the Agent saves your own words with `productkit intake` and starts Clarification. If it does not, the Agent asks once before running `productkit init`. Bug fixes, small edits and questions do not trigger it, and a repository whose own instructions name a different planning process keeps that process; the Agent only mentions ProductKit as an option. Start a new Agent session after the link is created.

The install only links Agents whose config folder already exists, never replaces an existing entry, never fails the install, and does nothing for a project-dependency (non-global) install. Set `PRODUCTKIT_SKIP_SETUP=1` to skip it.

Run the link step yourself when the install did not run it (`npm install --ignore-scripts`, `npm link`) or to change it:

```sh
productkit setup                 # link for every Agent whose config folder exists
productkit setup --agent codex   # name an Agent; creates its folder if needed
productkit setup --dry-run       # show what would change
productkit setup --remove        # remove the link this installation created
```

`setup` writes one symlink per Agent and nothing else. A real directory or file at the link path is never touched; a symlink that points to a different location is replaced only with `--force`. `productkit init` still writes only inside `product/`.

Only the entry Skill is linked. Each stage Skill (`clarify`, `model`, `graph`, `challenge`, `propose`, `define`, `validate`) is read from the path the CLI prints as `Instruction:`, so stage names never collide with other Skills. Helper values the stage Skills need (steps hash, entry hash, atomicity verdict) come from `productkit compute`, which works from any directory; `import('productkit')` does not resolve a global install.

On Windows, symlink creation may need Developer Mode or an elevated shell. If `setup` reports an error, copy `skills/productkit` from the installed package into the same Skill folder instead; do not copy authentication settings.

## ProductKit and OpenSpec

ProductKit's normal installed runtime does not include OpenSpec. To run `productkit export openspec`, install the pinned validator in the consuming workspace so ProductKit can resolve it there:

```sh
npm install --save-dev @fission-ai/openspec@1.14.0
```

Export still requires a current ProductKit Approval and runs OpenSpec Strict Validation before publishing. The validator runs as a child process with a 30-second timeout. This is process separation, not an operating-system sandbox. OpenSpec 1.14.0 has a known High transitive dependency advisory; until upstream publishes a fix, run strict validation only on trusted workspaces. Do not treat the full OpenSpec dependency tree as vulnerability-free. ProductKit does not use `npm audit --force` to install a breaking downgrade.

## Workspace and user decisions

Tell the Agent your idea (or run `productkit init` in the target app yourself), then follow the relevant Skills and CLI help. The CLI checks structure, references and hashes; it does not perform semantic review or create user confirmations. Only the actual user may provide and record Clarification confirmation, relationship confirmation, Decisions, or final Approval. Never put real product data into this ProductKit source repository.

For a company workspace, follow company data-classification, retention, AI-tool, and repository policies before providing prompts or generated artifacts to an Agent. ProductKit does not authorize transferring company data to a personal account or service.
