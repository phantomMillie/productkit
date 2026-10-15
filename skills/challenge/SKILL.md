---
name: challenge
description: Critically inspect current ProductKit requirements after clarification, atomic modeling, and graph validation. Record semantic Finding proposals and review coverage without deciding policy or claiming exhaustive correctness.
---

# Requirement Challenge

Use the installed ProductKit workspace and CLI. The CLI does not call an LLM; you perform the semantic review.

Order matters. Findings — including the user's confirmations — are inputs of a ChallengeRun, as are Nodes, Graph records and this Skill. Any change to them after `review-start` makes that review stale, so record Findings and confirmations first and start the review last.

1. Establish and state the scope. Default scope is every current modeled NodeGroup. Record exclusions and why they were not reviewed.
2. Read current Prompt, Clarification, NodeGroup/Nodes, Graph Edges and RelationCandidates, ImpactReports, existing Findings, and Change 02–04 structural validation output. Fix no upstream gate here and do not repeat its structural algorithm.
3. Review missing requirements and exceptions, policy conflicts and duplicates, and impact coverage. Compare applicability before calling constraints conflicting.
4. Review normal behavior, then exception, failure, and boundary flows. Inspect AND/OR, condition scope, and precedence. Do not invent product decisions for missing boundaries.
5. Compare Prompt → Clarification → Node meaning, including actors, conditions, outcomes, exceptions, and logical operators. Inspect Graph relation meaning/direction and possible omitted impact candidates.
6. For each plausible issue, write a counterexample as a hypothesis unless observed evidence proves it. Distinguish evidence from inference and record uncertainty and the question a user or later Decision must answer.
7. Submit a typed Finding YAML with `productkit challenge finding add --input <file>`. New Findings are always `proposed` and `unresolved`. Do not confirm, reject, resolve, defer, or dismiss on the user's behalf. Ask the user which Findings are real problems; for each explicit reply, use the exact user statement with `productkit challenge finding confirm <FND-ID> --response confirmed|rejected --user-statement <exact words> --rationale <user reason>`.
8. Only now run `productkit challenge review-start` and record the review ID. Checkpoint all eight areas with `productkit challenge review-area <review-id> <area> --status reviewed` (or `not_applicable --rationale ...`). Areas: `missing_requirements_exceptions`, `policy_conflicts_duplicates`, `flow_gaps`, `condition_operator_consistency`, `graph_relation_risks`, `prompt_node_fidelity`, `verifiability`, `impact_coverage`.
9. Report unreviewed scope, missing inputs, uncertainty, proposed Finding count, confirmed/rejected counts, and open Critical Findings. Finish with `productkit challenge review-complete <review-id>` only after every area is covered. A complete review means coverage was recorded; it does not prove semantic correctness, resolve Findings, or approve the Product Definition.
10. Later Finding resolutions (Decision applications) change these inputs again. `productkit validate` needs a current, complete ChallengeRun, so repeat step 8–9 on the final state before validation.

If interrupted, resume with `productkit challenge review-resume <review-id>` only while the input snapshot is current. Changed input makes the previous review stale; the CLI lists which inputs moved. Preserve it and start a new review. Never state that all issues were found. Keep possible counterexamples and demonstrated defects distinct.
