# Design

## Context

2026-10-15 사용자 보고: "설치했으니 아이디어를 말하면 ProductKit이 돌아갈 거라고 기대했다." 실제로는 아무 Agent도 ProductKit을 알지 못했다. 이 PC의 `~/.claude/skills`, `~/.codex/skills`, 대상 저장소 `.claude/skills`·`.agents/skills` 어디에도 연결이 없었다.

사용자 결정(같은 날):
- 아이디어를 말하면 "ProductKit을 쓸 수 있는데 쓸까?"처럼 질문으로 제안한다.
- workspace(`product/`)가 있으면 묻지 않고 바로 시작한다. 없으면 init 여부를 한 번 묻는다.

## Decisions

### D1. 사용자 Skill 폴더에는 진입 Skill 하나만 연결한다

7개 단계 Skill을 모두 전역에 연결하지 않는다. 이유:
- `clarify`·`model`·`graph`·`validate` 같은 일반 이름은 다른 Skill·명령과 겹친다.
- 단계 Skill은 CLI가 이미 절대 경로로 안내한다(`Instruction: .../skills/<stage>/SKILL.md`). Agent는 그 경로를 읽으면 된다(Change 02 D6의 경로 그대로).
- 자동 선택이 필요한 지점은 "아이디어를 들었을 때" 하나다.

진입 Skill 이름은 `productkit`이다. Agent Skills 규격대로 디렉터리 이름과 frontmatter `name`이 같다.

### D2. 연결은 `init`이 아니라 설치 단계에서 한다

Change 02 D6이 지킨 원칙("`init`은 대상 앱의 `product/` 밖에 쓰지 않는다")은 유지한다. 대상 앱 저장소가 아니라 사용자 Agent 설정 폴더에, `init`이 아니라 `setup`·전역 postinstall이 쓴다. D6이 기각한 것은 "`init`이 대상 앱 `.claude/skills/`에 쓰는 것"이고, 이번 변경은 그것을 하지 않는다. 다만 D6의 "연결은 사용자가 선택적으로 직접 한다"는 전제는 바꾼다. 사용자 요구는 설치만으로 동작하는 것이다.

- postinstall은 `npm_config_global=true`일 때만 실행한다. 프로젝트 의존성으로 설치할 때 홈 폴더를 바꾸지 않는다.
- postinstall은 설정 폴더가 이미 있는 Agent(`~/.claude`, `~/.codex` 또는 `CLAUDE_CONFIG_DIR`·`CODEX_HOME`)에만 연결한다. 쓰지 않는 Agent의 폴더를 새로 만들지 않는다. `productkit setup --agent codex`처럼 명시하면 만든다.
- postinstall은 어떤 오류에도 exit 0이다. 연결 실패가 설치 실패가 되면 안 된다. `PRODUCTKIT_SKIP_SETUP=1`이면 건너뛴다.
- `npm install --ignore-scripts`, `npm link`처럼 postinstall이 돌지 않는 설치는 `productkit setup`을 한 번 실행한다.

### D3. 복사가 아니라 symlink로 연결하고, 남의 항목은 덮어쓰지 않는다

symlink는 패키지를 갱신하면 Skill도 따라 갱신된다. 복사본은 낡는다.

Constitution 10(조용히 덮어쓰지 않는다)에 맞춰:
- 대상 경로가 없으면 만든다.
- 이미 같은 위치를 가리키는 symlink면 그대로 둔다.
- 다른 위치를 가리키는 symlink, 실제 디렉터리·파일이면 충돌로 보고하고 손대지 않는다. `--force`는 symlink만 교체한다. 실제 디렉터리·파일은 어떤 경우에도 지우지 않는다.
- `--remove`는 이 설치의 진입 Skill을 가리키는 symlink만 지운다.

### D4. 계산은 `import('productkit')`가 아니라 CLI 명령으로 한다

전역 설치 패키지는 대상 앱에서 ESM import로 해석되지 않는다. `npm root -g` 경로 조합도 Node 버전 관리자마다 달라 믿을 수 없다(실제로 `.devenv` Node의 전역 루트와 Homebrew 전역 루트가 달랐다). CLI는 Agent가 이미 호출하는 경로이므로 `productkit compute <helper>`로 같은 라이브러리 함수를 부른다. 함수 자체는 바꾸지 않는다. 결과가 CLI 검증과 같다는 보장이 그대로 유지된다.

입력은 파일 경로 또는 `-`(stdin)이다. `entry-hash`·`atomicity-final`은 JSON 객체를 받는다.

### D5. 진입 Skill의 판단 규칙

- 제안 대상: 새 제품·기능 아이디어, 무엇을 만들지 아직 모호한 요구, "정의/기획/명세로 정리"하자는 요청.
- 제외: 버그 수정, 문구·스타일 같은 작은 수정, 이미 명세가 확정된 구현 작업, 질문·설명 요청.
- 대상 저장소의 지시 파일(CLAUDE.md·AGENTS.md 등)이 다른 기획 절차를 정하면 그 절차를 따른다. ProductKit은 한 줄 제안만 하고 사용자가 고르면 쓴다.
- workspace가 있으면 묻지 않고 사용자 발화 원문을 `intake --file`로 저장한다. 요약·번역·정리하지 않는다(Constitution 4).
- workspace가 없으면 한 번 묻는다. 거절하면 같은 대화에서 같은 아이디어로 다시 묻지 않는다.
- 이미 진행 중인 workspace면 상태 명령(`clarify`·`model`·`graph`·`validate`)으로 다음 단계를 찾는다.

### D6. 단계 Skill frontmatter는 이번에 추가하지 않는다

challenge·validate Skill 본문은 ChallengeRun·Validation 입력 hash에 들어간다. frontmatter를 더하면 기존 사용자 결과가 stale이 된다. D1로 단계 Skill은 자동 선택 대상이 아니므로 frontmatter가 필요 없다. 프로젝트별로 단계 Skill을 직접 연결하는 기존 방법은 문서에서 내린다.

## Risks

- 자동 선택은 Agent 모델의 판단이다. description이 있어도 놓치거나 과하게 제안할 수 있다. 실제 Agent 실행으로 확인한 범위를 verification에 적는다.
- Codex가 symlink된 Skill 디렉터리를 읽는지는 실행으로 확인한다. 읽지 못하면 Codex만 복사 방식으로 바꾼다.
- Windows symlink 권한은 다루지 않는다. 실패하면 오류를 보고한다.
