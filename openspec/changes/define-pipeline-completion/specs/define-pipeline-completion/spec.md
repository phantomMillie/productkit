# Spec Delta

## ADDED Requirements

### Requirement: 검증된 내용 결정은 대상 Finding을 해결한다

`define application verify`가 `verified`를 기록하면, 그 Application의 Decision이 `content_decision`인 경우 Decision이 가리키는 Finding 중 확인됨·미해결·claim hash 일치인 것을 `resolved`로 기록해야 한다(SHALL). `scope_exclusion`이거나 `verified`가 아니면 해결해서는 안 된다(MUST NOT). 해결은 그 Decision, Proposal, ChallengeRun, 다른 Application의 최신성을 바꾸어서는 안 된다(MUST NOT).

#### Scenario: 검증 후 해결
- **WHEN** Critical Finding을 다루는 content Decision의 Application을 적용하고 verified로 검증한다
- **THEN** Finding은 resolved, decision_ref는 그 Decision이며 validation에 그 Finding의 fail 검사가 없다
- **AND** Decision·Application·ChallengeRun은 stale이 아니다

#### Scenario: 결론 없는 검증
- **WHEN** 검증을 inconclusive로 기록한다
- **THEN** Finding은 미해결로 남는다

### Requirement: 직접 결정도 Proposal에 응답한다

검증은 Proposal을 snapshot에 인용하고 Proposal의 모든 Finding을 `finding_refs`에 담은, 대체되지 않은 최신 `direct_user_decision`도 그 Proposal의 응답으로 인정해야 한다(SHALL).

#### Scenario: 수정된 선택
- **WHEN** 사용자가 선택지를 고친 직접 결정을 기록하고 그 Application이 적용·검증된다
- **THEN** 해당 `proposal.*` 검사가 실패하지 않는다

### Requirement: Decision은 원문 Prompt를 가리킨다

`decide record`는 `input_snapshot`에 `kind: prompt` 항목이 없는 Decision을 거절해야 한다(SHALL).

#### Scenario: Prompt 없는 Decision
- **WHEN** Prompt 없이 Decision을 기록한다
- **THEN** "must include the source Prompt"로 거절한다
