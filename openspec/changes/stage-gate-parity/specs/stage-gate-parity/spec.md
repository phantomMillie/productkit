# Spec Delta

## ADDED Requirements

### Requirement: clarify는 확인 전에 구조 문제를 알린다

확인을 기다리는 Clarification(`no_confirmation`·`not_agreed`·`missing_user_statement`·`content_changed_since_confirmation`)에 대해 `productkit clarify`는 확인과 무관한 완료 검사(steps 구조, Prompt 결합, span 참조)를 함께 실행해 결과를 출력해야 한다(SHALL). 완료 판정 규칙을 바꿔서는 안 된다(MUST NOT).

#### Scenario: 구조 문제가 있는 초안
- **WHEN** elaboration 문장이 decomposition 문장과 다른 초안에 확인 기록이 없다
- **THEN** 출력에 "Fix before asking the user to confirm"과 구조 사유가 나온다

#### Scenario: 구조가 완전한 초안
- **WHEN** 모든 구조 검사를 통과하고 확인 기록만 없다
- **THEN** 출력에 사용자 확인만 남았다는 Pre-check가 나온다

### Requirement: model Gate가 다시 계산하는 값은 CLI로 계산할 수 있다

`productkit compute clarification-content-hash`는 `clarificationContentHash(parseClarification(...))`와 같은 값을, `productkit compute structural-signal`은 `computeStructuralSignal`과 같은 값을 출력해야 한다(SHALL).

#### Scenario: CLI 값만으로 만든 NodeGroup
- **WHEN** `source_content_hash`·`clarification_content_hash`를 compute 출력으로 채운 NodeGroup을 검사한다
- **THEN** `productkit model`이 modeled로 판정한다

### Requirement: 대칭 관계는 추가할 때 canonical 순서로 저장한다

`productkit graph edge add`는 `conflicts_with`·`duplicates` Edge의 끝점을 canonical ID 순서로 바꿔 저장하고 바꾼 사실을 출력해야 한다(SHALL). 방향이 있는 관계의 끝점은 바꾸어서는 안 된다(MUST NOT).

#### Scenario: 역순으로 제출한 충돌 관계
- **WHEN** `conflicts_with` source `NOD-001-9`, target `NOD-001-10`을 추가한다
- **THEN** `NOD-001-10 -> NOD-001-9`로 저장하고 그 사실을 출력한다
