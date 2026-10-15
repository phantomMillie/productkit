# Spec Delta

## ADDED Requirements

### Requirement: 검증 입력만 바뀐 Application은 다시 검증할 수 있다

`define application verify`는 stale 사유가 검증 입력 변화뿐인 Application의 새 검증을 기록해야 한다(SHALL). Decision이 바뀌었거나 대상 파일이 바뀐 Application은 계속 거절해야 한다(MUST).

#### Scenario: 무관한 입력 변경 후 재검증
- **WHEN** 검증 뒤 다른 Policy가 추가되어 사유가 "Post-application verification inputs changed"뿐이다
- **THEN** 재검증이 기록되고 Application은 최신이 된다

### Requirement: 대체된 결정의 Application은 readiness에서 빠진다

검증은 `supersedes_decision_ref`로 대체된 Decision의 Application을 readiness 검사에서 제외해야 한다(SHALL).

#### Scenario: 결정 대체 후 정책 교체
- **WHEN** 대체 결정의 Application이 기존 Policy를 교체하고 적용·검증된다
- **THEN** 대체된 Application의 검사는 없고 새 Application은 pass다
