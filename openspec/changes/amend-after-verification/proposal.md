# Proposal

## Why

2026-10-15 millie-app-tools 정의가 READY에 닿은 뒤, 사용자가 정책 조건 하나를 고치는 조건으로 승인했다. 그런데 검증이 끝난 뒤에는 수정할 길이 없었다.

- 정책 하나만 바꿔도 모든 Application의 검증 지문(artifact hash 전체)이 바뀌어 stale이 되고, stale Application은 다시 검증할 수 없었다(`recordApplicationVerification`이 거절).
- 결정을 대체해도 대체된 결정의 Application이 대상 파일 변경으로 stale이 되어 readiness를 영원히 막았다. Application은 지울 수 없다.

## What Changes

- 대상 파일과 Decision이 그대로이고 검증 입력만 바뀐 Application은 다시 검증할 수 있다. Decision 변경이나 대상 파일 변경은 계속 거절한다.
- 대체된 Decision의 Application은 이력으로 보고 readiness 검사에서 제외한다. 대체한 Decision의 Application이 그 대상을 교체할 수 있다.
- `createPolicy`·`createJourney`는 입력에 남아 있는 옛 `content_hash`·`id`를 무시한다.
- define Skill에 수정 절차(대체 결정 → 교체 Application → 다른 Application 재검증 → semantic review 재기록)를 적는다.

## Capabilities

### New Capabilities

- `amend-after-verification`: 검증 뒤에 사용자 결정으로 정의를 고쳐도 readiness로 돌아올 수 있는 경로.

### Modified Capabilities

없음.

## Impact

`src/clarification/definition-store.ts`, `validation-store.ts`, `src/schema/definition.ts`, define Skill, 테스트.
