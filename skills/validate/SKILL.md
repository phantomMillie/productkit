# ProductKit Validation & Approval

Use this skill after Change 07 has produced a draft Product Definition.

1. Run `productkit validate` and inspect every blocking, warning, stale, and unreviewed input.
2. Read the current Definition, Journey, Policy, Findings, Decisions, Applications, Graph/Impact reports, Assumptions, and current ChallengeRun.
3. Review the eight required areas: requirement completeness, user flow, policy consistency, acceptance criteria, assumptions, graph/impact, traceability, and counterexamples. State the reviewed scope and every item not reviewed.
4. For each suspected defect, separate observed evidence from a hypothetical counterexample. Submit it through the existing Finding process; do not set Finding resolution or claim all defects were found.
5. Bind the assessment to the current Definition hash and fingerprint. `productkit validate` exits 1 while the semantic review is missing but still writes `product/validations/VAL-*.yaml`; copy `definition_hash`, `input_fingerprint` and the `input_snapshot` hashes for `evidence_refs` from it. All eight `areas` keys are required, `unreviewed_scope` must be empty to pass, and no other artifact may change between this report and the review. Record it with `productkit validate review --input <yaml>`; do not claim this proves semantic correctness.
6. Re-run `productkit validate --review <id>`. Report machine status separately from semantic assessment. Never create or imply user approval.
7. Only after the user explicitly responds with approval may the agent run `productkit approve record --validation <id> --user-statement <verbatim response> --scope <scope>`. If no user response exists, stop with approval missing.

The CLI validates schemas, references, and hashes. It cannot authenticate the speaker or establish that a user's statement is true. A PASS is not evidence of semantic completeness.
