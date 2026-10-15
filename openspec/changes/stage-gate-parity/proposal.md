# Proposal

## Why

2026-10-15 millie-app-tools에서 실제 아이디어를 clarify → model → graph로 진행하는 동안, 단계 Skill이 알려 주지 않은 Gate 규칙에 세 번 막혔다.

- clarify: "elaboration 문장은 decomposition 문장과 글자까지 같아야 한다" 같은 구조 규칙이 Skill에 없다. CLI는 사용자 확인이 생긴 뒤에야 이 구조를 검사해서, 사용자가 동의한 뒤에 문제가 드러났다. 고치면 steps 해시가 바뀌어 같은 해석을 두 번 확인받아야 했다.
- model: Skill 예시에 `clarification_content_hash`, `retired_nodes`·`split_from`, decomposition마다 세 보존 검토(`condition_preservation`·`operator_preservation`·`exception_preservation`)가 없다. `clarification_content_hash`를 계산하는 CLI 경로도 없어 Agent가 라이브러리 내부 경로를 직접 import해야 했다.
- graph: `conflicts_with`·`duplicates`는 문자열 ID 순서로만 저장되는데(`NOD-001-11`이 `NOD-001-8`보다 앞), Skill에 없고 `edge add`가 거절만 했다.

## What Changes

- `productkit clarify`가 확인을 기다리는 상태에서 구조 Pre-check를 함께 출력한다. 막히는 구조 문제가 있으면 "Fix before asking the user to confirm"과 사유를, 없으면 사용자 확인만 남았다고 알린다. 판정 규칙(`judgeCompletion`)은 바꾸지 않는다.
- `productkit compute`에 `clarification-content-hash`, `structural-signal`을 더한다.
- `productkit graph edge add`가 대칭 관계를 canonical 순서로 바꿔 저장하고 그 사실을 출력한다. `edges.yaml`을 손으로 고친 비정규 순서는 여전히 검증에서 잡는다.
- clarify·model·graph Skill에 CLI가 실제로 검사하는 규칙을 적는다.

## Capabilities

### New Capabilities

- `stage-gate-parity`: 단계 Gate가 다시 계산하거나 검사하는 값을 Agent가 사용자에게 묻기 전에 알고 계산할 수 있게 하는 계약.

### Modified Capabilities

없음. Gate 판정 결과는 바뀌지 않는다.

## Impact

`src/schema/clarification.ts`(`preConfirmationIssue` 추가), `src/cli/commands/clarify.ts`·`compute.ts`·`graph.ts`·`model.ts`(출력 한 줄), `src/index.ts`, clarify·model·graph Skill, 테스트. challenge·validate Skill은 입력 해시라 건드리지 않는다.
