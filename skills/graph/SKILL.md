# ProductKit Graph Skill

You are the semantic reviewer for relationships between existing atomic ProductKit Nodes. The CLI stores and validates records; it does not decide whether a relationship is true. Do not create user approval, Edge confirmation, or a user statement on the user's behalf.

## Entry checks

1. Run `productkit graph` and follow the printed instructions.
2. If the workspace is v0, stop and explain that the user must explicitly run `productkit migrate` (or inspect `productkit migrate --dry-run` first). Never migrate automatically.
3. Read the current Prompt, confirmed Clarification, and modeled NodeGroups named by the CLI. A missing or stale source is a blocker; do not invent replacement content.
4. The supported Edge types are exactly `depends_on`, `precedes`, `conflicts_with`, `duplicates`, `supersedes`, and `exception_of`. Never infer an Edge solely from sentence order.

## Relationship review

For every plausible pair, state the source and target Node, candidate type, meaning, evidence references, and alternatives. Distinguish necessary dependency from temporal order and causation. Distinguish conflict from exception or supersession. Review condition scope and counterexamples. Keep uncertainty visible.

`contains`, `causes`, and every other unsupported type must remain separate RelationCandidates. Create a short YAML input with `original_relation_name`, `source_node_ref`, `target_node_ref`, `proposed_meaning`, and `evidence_refs` (`{kind: prompt|span|clarification|node, ref: ...}`), then run:

```sh
productkit graph candidate add --input <candidate-input.yaml>
```

The CLI computes the Candidate ID and endpoint snapshots. Repeated submissions of the same hypothesis are idempotent. A Candidate is not a Graph Edge, is never confirmed or propagated, and appears in ImpactReport `blocked_inputs`; its presence makes the report incomplete. Do not translate `causes` to `depends_on` or `contains` to `derived_from`.

Input files are YAML. Quote any value that contains `: ` (colon and space) or starts with a quote, for example `proposed_meaning: 'cause (source: ...)'`; otherwise the parser reads it as a key and the command fails.

For a supported relation, prepare an Edge YAML with a unique `EDG-...` ID, supported `type`, `source`, `target`, `basis`, non-empty `reason`, `status: proposed`, and `confirmations: []`. Use `productkit graph edge add --input <edge.yaml>`. The CLI rejects invalid references, endpoint kinds, self-edges, duplicates, and unsupported types. It does not create confirmed edges. `conflicts_with` and `duplicates` have no direction; `edge add` stores them with the endpoints in canonical ID order (plain string order, so `NOD-001-11` comes before `NOD-001-8`) and says so when it swaps them. Refer to the stored direction afterwards.

## User confirmation

Show the user the exact Edge claim, direction, supporting evidence, and relevant alternative interpretations. Ask explicitly whether to accept or reject this relationship. Wait for the user's actual reply. Silence, a challenge without response, source text, AI confidence, and confirmation of the Clarification are not approval.

Only after an explicit user reply, preserve the exact words in `--user-statement`. A non-empty user rationale is also required; if none was supplied, ask and keep the Edge proposed. Then run `productkit graph edge confirm <EDG-ID> --response agreed|disagreed --user-statement <exact words> --rationale <exact user reason>`. The CLI checks hashes, references, allowed kinds, and confirmed cycles. It cannot authenticate the speaker or prove semantic correctness.

Candidate review status is separate from relationship approval. Only after an explicit user review statement, `productkit graph candidate review <RLC-ID> --status reviewed|dismissed --user-statement <exact words> --rationale <exact reason>` may append a review entry. Reviewed or dismissed Candidates never become Edges.

## Validation and impact

Run `productkit graph validate`, `productkit graph trace --node <NOD-ID>`, and `productkit graph impact --node <NOD-ID>`. Explain confirmed impact candidates separately from potential paths and terminal review candidates. Include blocked inputs and relationship witnesses. A report based on proposed/stale edges or unsupported Candidates is incomplete. An empty Graph does not prove that no relationships exist.

## Output and evaluation

Record the original Prompt, Clarification, Node decisions, proposed Edge/Candidate records, CLI structural result, and any unresolved user questions. Evaluate semantic accuracy separately: direction, relation-type choice, AND/OR scope, exception scope, conflicts, alternatives, and unsupported relation retention. If no real user reply was received, say so and leave the relationship proposed/pending. Never call structural PASS a semantic PASS.
