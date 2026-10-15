# Proposal & Decision

Use this skill after Challenge has produced Findings. The CLI validates local structure and hashes; it does not call an LLM, verify semantic correctness, or authenticate the speaker of a recorded statement.

## Review sequence

1. Read current Findings, their review state, evidence and linked Challenge/Graph inputs. Work only from current hashes; report stale inputs instead of reusing them.
2. Present alternatives with evidence, expected impacts, side effects, benefits, costs, risks, assumptions and residual issues. For every Proposal option, state its approach for every targeted Finding.
3. Keep an AI recommendation separate from the user's choice. Save Proposal input with `productkit propose add --input <yaml>`; this records alternatives only.
4. Ask the user to choose an option or state a different decision. Preserve the user's exact words in `--user-statement`; if no answer is given, stop without creating a Decision.
5. Record choice details with `productkit decide record --input <yaml> --user-statement <exact words> --rationale <reason> --scope <scope>`. For a direct decision, encode `selection.kind: direct_user_decision` and the exact chosen text in the input.
6. Report the Decision as `pending_application`. Change 06 does not apply it, resolve or defer a Finding, or assert semantic success. Change 07 owns application; later review owns outcome verification.

For a Critical Finding scope exclusion, require an explicit user statement, excluded scope, impact, rationale and residual risk. The record remains a scope exclusion, not a resolution, and the Finding stays unresolved.

## Input files

Hashes come from the CLI, never from a hand-written computation:

- `productkit compute input-hashes [--kind finding|node|edge|proposal|...]` prints current entries as `- { kind, ref, content_hash }`, ready to paste into `input_snapshot` and `evidence_refs`.
- `productkit compute finding-claim-hash <FND-ID>` prints the `claim_hash` for `finding_refs` (also an Assumption's `finding_hash`).

Proposal input (`productkit propose add --input`). Every Finding must be `confirmed` first; every option needs at least one entry in each list and a `finding_coverage` entry for every targeted Finding. Option IDs match `^[A-Z][A-Z0-9_-]{1,31}$` — at least two characters, so use `OPT-A`, not `A`.

```yaml
finding_refs:
  - { finding_ref: FND-..., claim_hash: <finding-claim-hash>, review_status: confirmed }
input_snapshot:
  - { kind: finding, ref: FND-..., content_hash: <from input-hashes> }
options:
  - id: OPT-A
    description: ...
    evidence_refs: [ { kind: finding, ref: FND-..., content_hash: ... } ]
    benefits: [ ... ]
    costs: [ ... ]
    risks: [ ... ]
    assumptions: [ ... ]
    expected_impacts: [ ... ]
    side_effects: [ ... ]
    target_candidates: []
    finding_coverage: [ { finding_ref: FND-..., approach: ..., residual_issues: [ ... ] } ]
  - id: OPT-B
    # ... at least two options
```

Decision input (`productkit decide record --input <file> --user-statement <exact words> --rationale <reason> --scope <scope>`; the three flags are merged into the file):

```yaml
decision_type: content_decision          # or scope_exclusion with scope_exclusion: {excluded_scope, impact, residual_risk}
finding_refs: [ { finding_ref: FND-..., claim_hash: ... } ]
selection: { kind: proposal_option, proposal_ref: PROP-..., option_ref: OPT-B }
proposal_ref: PROP-...                   # must repeat the selection for proposal_option
option_ref: OPT-B
input_snapshot:
  - { kind: finding, ref: FND-..., content_hash: ... }
  - { kind: proposal, ref: PROP-..., content_hash: <proposal claim hash, from input-hashes> }
```

When the user chooses something that is not exactly one option (a combination or an amended option), use `selection: { kind: direct_user_decision, text: <the user's chosen text> }` and omit `proposal_ref`/`option_ref`.

Never invent a user statement, select an option on the user's behalf, or claim that a hash proves who spoke. If the user has not replied, leave the Decision uncreated and report the pending question.
