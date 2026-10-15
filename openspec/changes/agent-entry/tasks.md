# Tasks

## 1. 진입 Skill

- [x] 1.1 `skills/productkit/SKILL.md`를 frontmatter(`name`·`description`)와 D5 판단 규칙으로 작성했다.
- [x] 1.2 `skills/clarify/SKILL.md` 예시에 `prompt_ref`·`prompt_content_hash`를 넣고(Clarification·확인 항목 양쪽), 진입 조건을 진입 Skill 흐름과 맞췄다. 계산 예시를 `productkit compute`로 바꿨다. 작업 중 `entry_hash` 설명이 "id 제외"로 틀려 있던 것을 찾아 "entry_hash만 빼고 id 포함"으로 고쳤다(`judgeCompletion`은 id를 포함해 다시 계산한다).
- [x] 1.3 `skills/model/SKILL.md`의 `evaluateAtomicityFinal` 예시를 `productkit compute atomicity-final`로 바꿨다.

## 2. CLI

- [x] 2.1 `productkit compute`(`steps-hash`·`entry-hash`·`atomicity-final`)를 추가했다.
- [x] 2.2 `productkit setup`(`--agent`·`--remove`·`--dry-run`·`--force`)을 추가했다.
- [x] 2.3 `scripts/postinstall.mjs`와 `package.json` `postinstall`·`files`를 추가했다.
- [x] 2.4 clarify 도움말의 수동 연결 안내를 `productkit setup`으로 바꿨다.

## 3. 테스트

- [x] 3.1 `tests/setup.test.ts` 9개: 처음 연결·재실행·폴더 없는 Agent 제외·명시 Agent 폴더 생성·환경 변수·실제 디렉터리 보존(`--force` 포함)·다른 symlink는 `--force`로만 교체·자기 링크만 해제·`--dry-run` 무쓰기·충돌 exit 1.
- [x] 3.2 `tests/compute.test.ts` 6개: 세 helper가 라이브러리 함수와 같은 값, 잘못된 입력 exit 2, CLI 등록, compute로만 만든 확인 기록이 실제 `runClarify`에서 `Clarification confirmed`.
- [x] 3.3 `tests/skills.test.ts` 4개: 진입 Skill frontmatter, 원문 보존·init 전 질문 문구, 단계 Skill에 `import('productkit').then` 없음, clarify 예시의 Prompt 결합.
- [x] 3.4 `tests/packaging.test.ts` +3개: tarball에 진입 Skill·postinstall 포함, 임시 prefix·임시 홈 전역 설치 시 `~/.claude/skills/productkit` 연결과 `~/.codex` 미생성, 로컬 설치 시 홈 미기록.

## 4. 문서

- [x] 4.1 README(en/ko)·`docs/installation.md`의 연결 안내를 `productkit setup` 기준으로 바꿨다.

## 5. 검증

- [x] 5.1 `npm run typecheck`, `npm run build` exit 0. `npm test` 35 files / 270 tests 통과.
- [x] 5.2 `openspec validate agent-entry --strict` 통과.
- [x] 5.3 2026-10-15 이 PC(Claude Code 2.1.300, codex-cli 0.162.1)에서 `productkit setup`으로 두 Agent에 연결하고 임시 저장소에서 실제 세션을 돌렸다.
  - Claude Code, `product/` 없음: init 없이 "ProductKit으로 먼저 정리할까요?"로 물었다.
  - Claude Code, `product/` 있음: `productkit` Skill을 불러 원문을 그대로 `intake`(raw_text 글자 단위 일치 확인)하고 `clarify` Instruction을 읽었다. CLR 파일 쓰기는 시험용 권한 설정이 막아 끝까지 가지 않았다.
  - Claude Code, 오타 수정 요청(`product/` 있음): ProductKit을 부르지 않았다.
  - Claude Code, 저장소 CLAUDE.md가 다른 PRD 절차를 정함: 그 절차대로 PRD 초안을 만들고 ProductKit을 실행하지 않았다. 한 줄 제안도 하지 않았다.
  - Codex, `product/` 없음: symlink된 `~/.codex/skills/productkit/SKILL.md`를 읽고 "ProductKit으로 정의할까요?"로 물었다.
  - Codex, `product/` 있음: `intake --file`로 원문을 저장하고 `clarify` Instruction에 따라 `prompt_content_hash`를 넣은 CLR-001을 썼다(구조 검사 통과, 확인 대기).
  - 미확인: GitHub URL로 실제 `npm install -g` 한 경우(임시 prefix의 tarball 전역 설치로 같은 lifecycle을 확인), Windows, Codex의 제외 대상·저장소 규칙 우선 경우, 사용자 확인을 거쳐 Clarification 완료까지 간 실제 세션.
