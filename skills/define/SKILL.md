# Product Definition and Policy Skill

## Purpose

Turn current, hash-valid Nodes and explicit user Decisions into a draft Product Definition, Journeys, Policies, and Acceptance Criteria. This skill performs semantic analysis; the CLI only checks structure, references, hashes, supported condition syntax, and application state.

## Inputs

- `product/sources/`, `product/discovery/`, `product/nodes/`, `product/graph/`
- Current Findings, Proposals, Decisions, Assumptions, and any existing Definition/Journey/Policy
- `productkit define status`, `productkit graph validate`, and relevant `productkit graph impact` output

## Workflow

1. Establish the requested Definition scope and identify every included and excluded input.
2. Read current Prompt, Clarification, NodeGroup/Node, Graph/ImpactReport, Finding, Decision, and Assumption records. Stop on stale or unresolved references.
3. Separate source statements, AI inferences, and explicit user Decisions. Every normative Definition item must cite a current Decision and a resolvable path to its source Prompt. Preserve Nodes as evidence; do not turn inference into a user commitment.
4. Draft goals, scope, stakeholders, functional and non-functional requirements, Journeys, policies, edge cases, and testable Acceptance Criteria. Keep the user's condition grouping, quantities, units, time scope, audience, and exception coverage intact. If uncertain, retain the source text and ask a question.
5. Structure policies as Context, Actor, Condition, Action, Outcome, Exceptions, and Priority. Use only the supported condition AST. Priority must cite a current user Decision. Never infer precedence from an `exception_of` edge.
6. Review policy pairs for conflict, exception, replacement, duplicate, independent constraints, and inconclusive cases. A shared condition region alone does not prove conflict. Record semantic concerns as proposed Finding candidates with evidence, counterexamples, and uncertainty; do not claim they are confirmed.
7. Preserve explicit scope exclusions and their residual risk. Keep unresolved Critical Findings and accepted-risk Assumptions visible.
8. Draft an Application preview only when a current explicit Decision calls for applying a change. Report all target hashes and before/after impact evidence; never claim applied until the CLI verifies every target after hash.
9. Run CLI structural validation and report errors, blocked inputs, stale data, unreviewed scope, and semantic uncertainties separately.

## Output

Create draft YAML inputs under `product/` and use the CLI to validate/persist them. Do not directly edit Finding status, Decision records, approval records, or source Prompt/Clarification/Node artifacts. Do not delete or overwrite prior versions.

## Questions and stop conditions

Ask the user when a product commitment, exception scope, priority, unresolved Finding, or Decision interpretation is missing. Leave the item unresolved. Do not fabricate a user response or declare the Definition approved.

## Completion

Report the Definition and artifact IDs, provenance snapshot, policy conflict candidates, residual risks, blocked/unreviewed scope, and CLI structural status. A structural PASS is not evidence of semantic completeness or final approval.

## Contract (what the CLI actually checks)

### Order

1. Every active Decision has the source Prompt in its `input_snapshot` (the CLI refuses it otherwise).
2. Save any ImpactReport you will cite (`productkit graph impact --node <NOD>`), then run the final challenge review (Findings, confirmations and ImpactReports are review inputs; Decision resolutions are not).
3. Draft Policies and Journeys, complete them with `productkit compute policy <draft>` / `productkit compute journey <draft>`; the printed YAML is the exact Application `after_content`.
4. `productkit define create --input <definition-input>` once, citing every Decision the Definition relies on. It never overwrites; later changes go through an Application that replaces `product/definition.yaml`.
5. One Application per active Decision (`define application plan --input`). Targets are only `product/definition.yaml`, `product/policies/<POL>.yaml`, `product/journeys/<JRN>.yaml`, and every target's content must cite that Decision. When the Definition already exists and an Application has nothing else to change there, use it as a no-op target (`before_content` = `after_content` = current text) so the Application still names it.
6. Apply every Application, then verify every one (`define application verify <APP> --input`, status `verified`). A verified Application of a `content_decision` marks the Findings that Decision targets as resolved. A `scope_exclusion` Decision never resolves; it needs a matching `kind: exclusion` Definition item instead.
7. Then follow the validate Skill.

### Hashes — three sets, do not mix them

| Used in | Finding | Others |
|---|---|---|
| Definition / Policy / Journey `provenance`, Definition `input_snapshot`, verify `evidence_refs` | claim hash: `productkit compute finding-claim-hash` | `productkit compute input-hashes`; Decision = its `decision_hash`; Policy/Journey/Definition = their `content_hash` |
| Proposal / Decision `input_snapshot` | `productkit compute input-hashes --kind finding` | `productkit compute input-hashes` |
| Semantic review `evidence_refs`, `input_fingerprint` | copy from the VAL report's `input_snapshot` | copy from the VAL report |

`before_hash` / `after_hash` are `productkit compute text-hash <file>` of the exact text.

### Freeze points

- After the first `verify`, do not change anything the verification fingerprint covers (Findings' claims, Nodes, Graph, ImpactReports, Policies, Journeys, the Definition, Decisions, the installed Skills). A stale verified Application cannot be re-verified, and every planned Application must end applied and verified — there is no delete. Do not plan speculative Applications and do not roll back.
- Each target file must still equal its Application's `after_hash`. Two Applications writing different content to the same file make the earlier one stale; write the Definition once and use no-op targets.
- Do not upgrade ProductKit mid-pipeline: Skill texts are part of the hashed inputs.

### Shapes and identifiers

- Definition item IDs are `ITM-` + 12 hex; Policy IDs are author-chosen `POL-` + 16 hex; Journey and Definition IDs are derived by the CLI.
- Policy `condition` grammar: `{op: all|any, args: [...]}` | `{op: not, arg: ...}` | `{op: eq|ne|gt|gte|lt|lte, field, value_type: string|number|boolean, value, unit?}`.
- A Journey needs `acceptance_criteria` and every reachable state must reach a terminal state.
- `before_impact_refs` needs one ImpactReport per Node cited in target `provenance.source_refs`; citing the NodeGroup, Clarification, Findings or Edges instead needs none.
