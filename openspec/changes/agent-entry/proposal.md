# Proposal

## Why

ProductKit을 전역 설치한 사용자가 Claude Code에서 새 기능 아이디어를 말해도 ProductKit이 시작되지 않았다(2026-10-15, millie-app-tools). 원인은 진입 경로가 끊겨 있는 데 있다.

- Change 02 D6은 "Agent가 대화만으로 ProductKit 사용을 판단해 CLI를 직접 호출한다"를 전제로 자동 연결을 기각했다. 그러나 Agent는 ProductKit이 설치돼 있다는 사실을 컨텍스트로 받지 못하면 그 판단을 할 수 없다. 설치만 한 환경에서는 어떤 instruction도 Agent에게 닿지 않는다.
- 사용자가 직접 연결하더라도 7개 Skill 중 6개에 frontmatter(`name`·`description`)가 없어 자동 선택 단서가 없고, 첫 단계(원문 저장)를 맡는 Skill이 없어 clarify는 사람에게 `intake`를 돌리라고 안내만 한다.
- clarify·model Skill의 계산 예시(`import('productkit')`)는 전역 설치 환경의 대상 앱에서 `ERR_MODULE_NOT_FOUND`로 실패한다. 전역 패키지는 ESM import로 찾을 수 없다.
- clarify Skill 예시에는 CLI가 요구하는 `prompt_ref`·`prompt_content_hash` 필드가 없다.

## What Changes

- 진입 Skill `skills/productkit/SKILL.md`를 추가한다. 새 제품·기능 아이디어를 들으면 workspace가 있을 때는 원문을 그대로 `intake`하고 `clarify`로 이어 가고, 없을 때는 ProductKit으로 정의할지 한 번 묻는다. 대상 저장소 지시가 다른 기획 절차를 정하면 그 지시를 따르고 제안만 한다. 버그·작은 수정에는 제안하지 않는다.
- `productkit setup` 명령을 추가한다. 진입 Skill 하나를 사용자 Skill 폴더(Claude Code `~/.claude/skills`, Codex `~/.codex/skills`)에 symlink로 연결하고 `--remove`로 해제한다. 기존 항목을 덮어쓰지 않는다.
- 전역 npm 설치(`npm install -g`) 때 postinstall이 `setup`을 실행한다. 설정 폴더가 이미 있는 Agent에만 연결하고, 실패해도 설치를 실패시키지 않으며, `PRODUCTKIT_SKIP_SETUP=1`로 끌 수 있다. 로컬(프로젝트 의존성) 설치에서는 아무것도 하지 않는다.
- `productkit compute` 명령을 추가한다(`steps-hash`·`entry-hash`·`atomicity-final`). clarify·model Skill은 `import('productkit')` 대신 이 명령을 쓴다.
- clarify Skill 예시에 `prompt_ref`·`prompt_content_hash`를 넣고, workspace·원문이 없을 때 진입 Skill 흐름을 따르게 한다.
- README·설치 문서의 연결 안내를 `productkit setup` 기준으로 바꾼다.

## Capabilities

### New Capabilities

- `agent-entry`: 설치 후 Agent가 ProductKit을 알아보고 아이디어에서 정의 흐름을 시작하는 진입 경로(진입 Skill, setup, 설치 시 연결, 계산 명령).

### Modified Capabilities

없음. Change 02의 진입 요구사항(`prompt-clarification` "진입 경로는 Agent의 명시적 CLI 호출이며 네이티브 Skill 자동선택에 의존하지 않는다")은 그대로 유지된다. `init`은 계속 `product/` 밖에 쓰지 않고, 명시적 CLI 호출 경로도 그대로 동작한다. 이번 변경은 그 경로에 Agent가 도달할 수 있게 하는 별도 진입 수단을 더한다.

## Impact

- 새 파일: `skills/productkit/SKILL.md`, `src/cli/commands/setup.ts`, `src/cli/commands/compute.ts`, `scripts/postinstall.mjs`, 테스트.
- 수정: `src/cli/program.ts`(등록·clarify 도움말), `package.json`(`postinstall`, `files`), `skills/clarify/SKILL.md`, `skills/model/SKILL.md`, README(en/ko), `docs/installation.md`.
- 손대지 않음: `init`의 쓰기 범위, challenge·validate·define·graph·propose Skill 본문(challenge·validate Skill 내용은 ChallengeRun·Validation 입력 hash에 들어가므로 바꾸면 기존 결과가 stale이 된다), 기존 사용자 workspace.
- 사용자 홈 폴더 쓰기: 전역 설치·`setup` 때 Agent Skill 폴더에 symlink 하나씩. 되돌리기는 `productkit setup --remove`.
