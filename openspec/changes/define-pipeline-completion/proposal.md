# Proposal

## Why

2026-10-15 millie-app-tools 아이디어를 Decision 단계까지 진행한 뒤, 같은 workspace 복사본으로 승인·내보내기까지 끝까지 돌려 보니 Product Definition이 `ready`에 닿을 수 없었다.

- **Finding을 해결할 경로가 없다.** 스키마에는 `resolution_recorded`·`change06_decision`이 있지만 이를 기록하는 코드가 없다. 사용자가 결정을 내린 Critical Finding은 거짓으로 "범위 제외"를 기록하지 않는 한 승인을 영원히 막는다.
- **직접 결정은 Proposal 검사를 통과하지 못한다.** 검증은 Proposal마다 `proposal_option` Decision만 인정한다. 사람 결정은 흔히 선택지를 고친 형태라 막다른 길이다. 대체된 Decision도 걸러지지 않았다.
- **Decision의 Prompt 연결 규칙이 숨어 있다.** Definition 항목은 Decision 자신의 snapshot에 Prompt가 있어야 인용할 수 있는데, 이 규칙은 define 시점에야 드러났다.
- 버그: ImpactReport ID가 시작 Node를 무시해 Node 둘을 인용할 수 없음, 앞뒤 공백이 있는 값은 create*에서 hash 불일치, Policy `relation_ref`가 그래프 Edge ID 형식과 다름, `challenge review-validate` 기본값이 최신이 아니라 파일명순 마지막 리뷰.
- Policy·Journey hash와 Application 텍스트 hash를 계산할 CLI가 없고, define·validate Skill에 순서·hash 종류·고정 시점이 없다.

## What Changes

- **Finding 해결 기록:** `content_decision`의 Application이 `verified`로 확인되면 그 Decision이 가리키는 확인된 미해결 Finding을 `resolved`로 기록한다(actor `change06_decision`, `decision_ref`). `scope_exclusion`은 해결하지 않는다.
- **Finding snapshot hash:** ChallengeRun·Proposal·Decision snapshot은 Finding을 "Decision 해결 직전 상태"의 hash로 인용한다. 해결 전에는 기존 전체 기록 hash와 같아 기존 기록은 그대로 유효하고, 해결이 원인이 된 Decision·Proposal·리뷰를 stale로 만들지 않는다.
- **직접 결정 인정:** Proposal을 snapshot에 인용하고 그 Finding을 모두 다루는 `direct_user_decision`도 그 Proposal의 응답으로 인정한다. 대체된 Decision은 어느 쪽이든 인정하지 않는다.
- **Prompt 연결 강제:** `decide record`는 snapshot에 Prompt가 없는 Decision을 거절한다.
- **버그 수정:** ImpactReport `analysis_id`에 시작 Node 포함, create*는 공백을 다듬은 값으로 hash·검증, `relation_ref`는 `EDG-[A-Za-z0-9-]+`, review-validate 기본값은 `created_at` 최신.
- **compute:** `policy`, `journey`(완성된 YAML 출력), `text-hash`.
- **Skill:** define에 계약(순서, hash 세 종류, 고정 시점, 식별자), validate에 semantic review 입력 출처, propose에 Prompt 필수·직접 결정 조건·대체 방법.

## Capabilities

### New Capabilities

- `define-pipeline-completion`: 사용자 결정에서 승인 가능한 Product Definition까지 CLI만으로 도달하는 계약.

### Modified Capabilities

없음. 기존 판정은 더 많은 경우를 통과시키거나(직접 결정, Decision 해결) 더 일찍 거절할 뿐(Prompt 없는 Decision), 통과하던 정상 경로를 막지 않는다.

## Impact

`src/schema/finding.ts`, `src/clarification/finding-store.ts`, `definition-store.ts`, `challenge-store.ts`, `proposal-decision-store.ts`, `validation-store.ts`, `graph.ts`, `hash.ts`, `src/schema/definition.ts`, `validation.ts`, `src/cli/commands/challenge.ts`, `compute.ts`, define·validate·propose Skill, 테스트. validate Skill 본문은 검증 입력 hash라 기존 Validation 보고서는 stale이 된다. 기존 ImpactReport 파일은 저장된 ID를 그대로 쓴다. 새로 만드는 보고서만 새 ID를 받는다.
