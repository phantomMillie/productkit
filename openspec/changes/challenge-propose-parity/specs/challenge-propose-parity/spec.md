# Spec Delta

## ADDED Requirements

### Requirement: stale 리뷰 오류는 바뀐 입력과 순서를 알려 준다

review-resume·review-area·review-complete가 stale 리뷰를 거절할 때 추가·변경·제거된 입력(`kind:ref added|changed|removed`)과 올바른 순서 안내를 출력해야 한다(SHALL). 판정 결과를 바꿔서는 안 된다(MUST NOT).

#### Scenario: 리뷰 도중 Finding 추가
- **WHEN** review-start 뒤에 Finding을 추가하고 review-area를 실행한다
- **THEN** exit 1로 거절하고 `finding:<id> added`와 순서 안내를 출력한다

#### Scenario: 올바른 순서
- **WHEN** Finding을 추가한 뒤 review-start, 모든 영역 체크, review-complete를 실행한다
- **THEN** COMPLETE coverage로 끝난다

### Requirement: Proposal·Decision 입력 hash는 CLI로 얻는다

`productkit compute input-hashes`는 Proposal·Decision 검증이 비교하는 현재 입력 hash와 Proposal claim hash를 `- { kind, ref, content_hash }` 형식으로 출력하고 `--kind`로 거를 수 있어야 한다(SHALL). `productkit compute finding-claim-hash <FND-ID>`는 `findingContentHash(toFindingInput(finding))`을 출력해야 한다(SHALL).

#### Scenario: 입력 hash 목록
- **WHEN** Finding이 있는 workspace에서 input-hashes를 실행한다
- **THEN** `currentChallengeInputs`의 모든 항목이 같은 hash로 출력된다
