# Proposal

## Why

2026-10-15 millie-app-tools에서 challenge → propose → decide를 실제로 진행하면서 세 곳에서 막혔다.

- challenge Skill은 "review-start → Finding 추가 → 영역 체크" 순서를 안내하는데, Finding과 사용자 확인은 ChallengeRun의 입력이다. Finding을 추가하거나 확인하는 순간 리뷰가 stale이 되어 체크할 수 없었다. 기존 E2E 테스트는 리뷰 도중 Finding을 추가하는 흐름을 다루지 않았다. stale 오류는 무엇이 바뀌었는지 알려 주지 않았다.
- Proposal·Decision·Assumption 입력에는 현재 입력 hash(`input_snapshot`, `evidence_refs`)와 Finding claim hash가 필요한데, 이를 출력하는 CLI가 없어 라이브러리 내부를 직접 불러야 했다.
- Proposal option ID 규칙(`^[A-Z][A-Z0-9_-]{1,31}$`, 두 글자 이상)과 입력 모양이 Skill에 없어 `A` 같은 ID로 실패한 뒤에야 알 수 있었다.

## What Changes

- challenge Skill 순서를 "Finding 추가 → 사용자 확인 → review-start → 영역 체크 → complete"로 바꾸고, 검증 전에는 최종 상태로 다시 리뷰하라고 적는다. ChallengeRun의 입력 정의는 바꾸지 않는다(Constitution 9).
- stale 리뷰 오류(review-resume, review-area, review-complete)가 추가·변경·제거된 입력 목록과 올바른 순서를 함께 출력한다.
- `productkit compute input-hashes [--kind]`(현재 입력과 Proposal claim hash를 `- { kind, ref, content_hash }`로 출력)와 `productkit compute finding-claim-hash <FND-ID>`를 추가한다.
- propose Skill에 hash helper, Proposal·Decision 입력 예시, option ID 규칙, direct_user_decision 사용 조건을 적는다.

## Capabilities

### New Capabilities

- `challenge-propose-parity`: Challenge·Proposal·Decision Gate가 비교하는 입력을 Agent가 올바른 순서로 만들고 CLI로 계산할 수 있게 하는 계약.

### Modified Capabilities

없음. Gate 판정과 입력 정의는 바뀌지 않는다.

## Impact

`src/clarification/challenge-store.ts`, `src/cli/commands/challenge.ts`, `src/cli/commands/compute.ts`, challenge·propose Skill, 테스트. challenge Skill 본문은 ChallengeRun 입력 hash에 들어가므로, 이 변경을 받은 workspace의 기존 ChallengeRun은 stale이 된다(의도된 동작이며 새 리뷰로 해소된다).
