<div align="center">

# ProductKit

**Ever asked for something "clean" and got back something you didn't picture at all?**

Words are fuzzier than we think. The same sentence lands differently on different people.<br>
ProductKit finds the spots in your idea where the meaning splits, and has you pick one yourself.

It's a local CLI plus Agent Skills for Claude Code and Codex. The AI asks questions, pushes back, and lays out options. You make the call. Who picked what, and why, stays on file.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-339933.svg)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/tag/gilgim/productkit?label=release)](https://github.com/gilgim/productkit/tags)

English · [한국어](README.ko.md)

</div>

---

## Words are fuzzier than we think

You've probably said something like this when handing off work:

> Make this screen clean. Just handle the rest.

You have a picture in your head. The person on the other end can hear it a bunch of different ways. (Made-up example, just to show the idea.)

| What you said | What they might hear |
|---|---|
| clean | fewer elements / tidier spacing and alignment / matching colors / refactored code |
| handle the rest | only what's on screen / related features too / ask me if stuck / don't ask, just go |
| (done) well | fast / safe / pretty / same as before |

Between people, you'd just ask, "Clean how?" AI usually doesn't ask. It picks whatever sounds reasonable and fills it in. The result looks fine, so you don't notice it guessed wrong. A few weeks later, nobody remembers which parts someone actually decided and which parts the AI made up.

## So we built this

ProductKit doesn't come up with ideas for you. **It finds the gaps in an idea you described loosely, and gets them filled in.** More precisely: it stops the AI from filling those gaps on its own, and makes sure a person does.

- When the meaning splits, the AI doesn't pick one. It leaves a question instead. That's a `FND-xxx` Finding.
- You decide which reading is right. Only when you say so, with a reason, does it become a `DEC-xxx` Decision.
- The CLI checks whether each step is really done. The AI can say "all done," but if the CLI doesn't pass it, it isn't.

## How the gaps get found

Drop in a one-line idea, and it walks through these steps one at a time.

1. **Save the original** (`intake`). Before any interpreting, your exact words get saved. Everything that comes later can be traced back to a specific part of them.
2. **Pin down the words.** What does "clean" mean here? It writes that down, and marks what you actually said (`user_stated`) separately from what the AI guessed (`ai_inferred`).
3. **Split the sentence.** If one sentence carries several requests, they get pulled apart. "Make it clean" and "handle the rest" are two different asks.
4. **Look for blanks.** Who, what, when, how. Whatever can't be filled in is a gap.
5. **Check for clashes.** See whether any of those requests conflict with or depend on each other.
6. **Check for other readings.** Find the places where the same words could mean different things, and list every reading. Nothing gets picked here. Picking is your job, so it goes to a Finding.
7. **"Here's what I got. Is that right?"** The AI puts its understanding right next to your original words and asks you to confirm. This step only ends when you say yes.

After that, the split readings get settled one by one.

```text
FND-003  no standard for "clean"   -> 3 readings (fewer elements / spacing / matching colors)
   ↓ Proposal: each option shown with its upsides, costs and risks
DEC-005  "fewer elements only"     -> you picked it; your reason is recorded
```

If even one Critical Finding is still open, the definition can't be finalized. Everything that gets decided can be traced back: Definition → Decision → your original words.

### Keeping the gaps closed

- An AI guess never counts as a decision. A `DEC-xxx` only exists when a person actually said it.
- If something changes after you approve, that approval is void. It needs a fresh look.
- There's no AI inside the CLI. The CLI just saves files and checks that they're in the right shape. The thinking happens in the Claude Code or Codex session you're already using, so there's no extra API key and no model being called behind your back.

## How it works

<p align="center"><img src="docs/assets/how-it-works.svg" alt="How ProductKit works: you decide, the agent reasons, the CLI judges and records" width="100%"></p>

You choose, the AI asks and thinks, and the CLI checks whether things are done and keeps the record.

## Quick start

You'll need Node.js 20.19+ and Git.

```bash
npm install --global "git+https://github.com/gilgim/productkit.git#v0.1.0-beta.1"
productkit --version        # 0.1.0-beta.1
```

> The `productkit` on npm is a different project that happens to share the name, so install from the GitHub tag like above.

A global install also links a `productkit` Skill into Claude Code and Codex (only the ones you already have). Open a new session in your app folder and just say the idea:

> I want an app where friends share their running logs

If the app has no `product/` workspace yet, the AI asks once whether to define the idea with ProductKit. Say yes and it runs `productkit init`, saves your words unchanged with `productkit intake`, and starts Clarification. Bug fixes and small edits don't trigger it. If the link is missing (say you installed with `npm install --ignore-scripts`), run `productkit setup` once. The [installation guide](docs/installation.md#connect-agent-skills) has the details.

You can also drive it by hand:

```bash
cd ~/projects/my-app
productkit init
productkit intake "<one line of idea to clear up>"
productkit clarify
```

`clarify` won't write anything for you. It just tells the AI what to do next:

```text
Prompt saved: PRM-001
  product/sources/PRM-001.yaml

AI action required: Clarification has not started.
  Prompt:      product/sources/PRM-001.yaml
  Instruction: skills/clarify/SKILL.md
  Write to:    product/discovery/CLR-001.yaml
  Bind prompt_ref + prompt_content_hash in the clarification and new confirmation; do not invent user agreement.
```

Until the work is actually done, the check won't pass:

```text
$ productkit validate
PRODUCT READINESS BLOCKED
FAIL definition.required: Product Definition is missing.
```

Once the definition is approved, you can export it to OpenSpec:

```bash
productkit export openspec --change <change-id> --capability <capability-id>
```

`export openspec` needs the OpenSpec CLI installed in your workspace. The [installation guide](docs/installation.md#productkit-and-openspec) has the details.

## What you get

`productkit init` gives you a workspace made of plain files. It's all Markdown and YAML, so you can diff it and review it in a PR.

```text
product/
├── sources/      your original idea, untouched
├── discovery/    who, what, why, and the flow
├── nodes/        requirements split as small as they go
├── graph/        how requirements relate and affect each other
├── findings/     gaps, assumptions, contradictions (split readings land here)
├── proposals/    options with upsides, costs and risks side by side
├── decisions/    what you actually picked + why
├── journeys/  policies/  assumptions/
├── validations/  semantic-reviews/  approvals/
└── exports/      records of what was exported to OpenSpec
```

## Principles

ProductKit has ten rules ([CONSTITUTION.md](CONSTITUTION.md)). Here are the ones that matter most:

1. Never record an AI guess as if a person decided it.
2. If something's unclear, don't guess. Leave a Finding.
3. Every decision needs a reason.
4. Everything in the definition has to trace back to the original idea.
5. When showing options, show the costs and risks too, not just the upsides.
6. Don't finalize the definition while a Critical Finding is still open.
7. Keep the product definition and the implementation spec apart. Don't make up DB schemas or APIs.

## Limits

- It's still a **v0 beta**. The structure (files, schemas, checks, hashes) is covered by 248 automated tests.
- Clearing up the ambiguity doesn't mean the product is right. Passing the check means the **format** is right. How many split readings get caught depends on the AI and on you.
- The CLI can't tell who typed a confirmation or approval. So please only record a decision or approval after a real person actually said it.

## Docs

| | |
|---|---|
| [CLI reference](docs/cli.md) | every command, option and exit code |
| [Architecture](docs/architecture.md) | roles, storage, checks |
| [Artifact contracts](docs/artifact-contracts.md) | field-level schemas |
| [Installation](docs/installation.md) | pinned install, Skills, OpenSpec |
| [Roadmap](docs/roadmap.md) | Change 01–09 |

## Development

```bash
git clone https://github.com/gilgim/productkit.git && cd productkit
npm install && npm run build
npm test
```

Issues and PRs are always welcome. ProductKit itself is developed with OpenSpec (`openspec/changes/`).

## License

[MIT](LICENSE)
