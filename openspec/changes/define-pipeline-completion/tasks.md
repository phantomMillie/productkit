# Tasks

- [x] 1. `appendFindingResolution`, `resolveFindingsByDecision`, verify 시 자동 해결.
- [x] 2. `findingSnapshotHash`를 ChallengeRun 입력에 사용(해결 전 = 전체 기록 hash).
- [x] 3. Proposal 검사가 직접 결정을 인정하고 대체된 Decision을 제외.
- [x] 4. `decide record` Prompt 필수.
- [x] 5. 버그: ImpactReport ID에 시작 Node, create* 공백 정규화(`trimDeep`), `relation_ref` 형식, review-validate 최신 리뷰.
- [x] 6. `compute policy|journey|text-hash`.
- [x] 7. define·validate·propose Skill.
- [x] 8. 테스트: `tests/decision-resolution.test.ts` 7개(해결·최신성 유지·inconclusive·직접 결정·snapshot hash·공백·ImpactReport ID·compute 출력), 기존 Decision 테스트에 Prompt 추가와 Prompt 없는 Decision 거절.
- [x] 9. `npm run typecheck`, `npm run build`, `npm test`, `openspec validate define-pipeline-completion --strict`.
