# Tasks

## 1. CLI

- [x] 1.1 `preConfirmationIssue`를 추가하고 `productkit clarify`가 확인 대기 상태에서 Pre-check를 출력한다.
- [x] 1.2 `productkit compute clarification-content-hash`, `structural-signal`을 추가한다.
- [x] 1.3 `productkit graph edge add`가 대칭 관계를 canonical 순서로 저장한다.
- [x] 1.4 `productkit model` 시작 안내에 compute helper를 적는다.

## 2. Skill

- [x] 2.1 clarify: 완료 검사 규칙 절(elaboration·relation 문장 일치, 필드, no-items 이유, 자리표시 값, Prompt 결합)과 확인 전 Pre-check 사용법.
- [x] 2.2 model: 예시에 `clarification_content_hash`·`retired_nodes`·`split_from`·세 보존 검토, 완료 검사 규칙 절.
- [x] 2.3 graph: 대칭 관계 저장 순서와 YAML 따옴표 주의.

## 3. 검증

- [x] 3.1 `tests/gate-parity.test.ts` 6개: Pre-check 두 경우와 Prompt 결합 누락, compute 값만으로 만든 NodeGroup의 실제 model Gate 통과, structural-signal 일치, 대칭 관계 canonical 저장.
- [x] 3.2 `npm run typecheck`, `npm run build`, `npm test`, `openspec validate stage-gate-parity --strict`.
