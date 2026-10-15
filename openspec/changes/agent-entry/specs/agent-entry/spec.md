# Spec Delta

## ADDED Requirements

### Requirement: 전역 설치는 진입 Skill을 Agent에 연결한다

전역 npm 설치(`npm_config_global=true`) 후 postinstall은 설정 폴더가 이미 있는 Agent(Claude Code: `CLAUDE_CONFIG_DIR` 또는 `~/.claude`, Codex: `CODEX_HOME` 또는 `~/.codex`)의 `skills/productkit`에 설치된 진입 Skill을 symlink로 연결해야 한다(SHALL). 로컬 설치에서는 아무것도 쓰지 않아야 한다(MUST NOT). 연결 실패는 설치 실패가 되어서는 안 된다(MUST NOT). `PRODUCTKIT_SKIP_SETUP=1`이면 건너뛰어야 한다(SHALL).

#### Scenario: 전역 설치
- **WHEN** `~/.claude`가 있는 환경에서 `npm install -g`로 설치한다
- **THEN** `~/.claude/skills/productkit`이 설치된 `skills/productkit`을 가리킨다
- **AND** `~/.codex`가 없으면 `~/.codex`를 만들지 않는다

#### Scenario: 로컬 설치
- **WHEN** 프로젝트 의존성으로 설치한다
- **THEN** 사용자 홈의 Agent 폴더에 아무것도 쓰지 않는다

#### Scenario: 연결 실패
- **WHEN** 연결 중 충돌이나 파일 시스템 오류가 난다
- **THEN** 사유를 출력하고 설치는 exit 0으로 끝난다

### Requirement: setup은 기존 항목을 덮어쓰지 않고 연결·해제한다

`productkit setup`은 `--agent claude|codex|all`(기본 `all`), `--remove`, `--dry-run`, `--force`를 지원해야 한다(SHALL). `all`은 설정 폴더가 있는 Agent만 대상으로 한다(SHALL). 대상 경로가 다른 위치를 가리키는 symlink이거나 실제 디렉터리·파일이면 충돌로 보고하고 바꾸지 않아야 한다(MUST NOT). `--force`는 symlink만 교체하고 실제 디렉터리·파일은 지우지 않아야 한다(MUST NOT). `--remove`는 이 설치의 진입 Skill을 가리키는 symlink만 지워야 한다(SHALL).

#### Scenario: 처음 연결과 재실행
- **WHEN** 연결이 없을 때 `setup`을 실행하고 다시 실행한다
- **THEN** 첫 실행은 symlink를 만들고 두 번째 실행은 이미 연결됨으로 보고하며 바꾸지 않는다

#### Scenario: 충돌
- **WHEN** 대상 경로에 사용자의 실제 디렉터리가 있다
- **THEN** 충돌을 보고하고 exit 1로 끝나며 디렉터리 내용은 그대로다

#### Scenario: 해제
- **WHEN** `setup --remove`를 실행한다
- **THEN** 이 설치를 가리키는 symlink만 지우고 다른 항목은 남긴다

#### Scenario: 미리 보기
- **WHEN** `setup --dry-run`을 실행한다
- **THEN** 할 일을 출력하고 아무것도 쓰지 않는다

### Requirement: 진입 Skill은 아이디어에서 정의 흐름을 시작한다

진입 Skill은 frontmatter `name: productkit`과 제안 조건·제외 조건을 담은 `description`을 가져야 한다(SHALL). Agent는 이 Skill에 따라 workspace가 있으면 사용자 발화 원문을 그대로 `intake`한 뒤 `clarify`가 안내하는 instruction을 따라야 하고(SHALL), workspace가 없으면 init 전에 사용자에게 한 번 물어야 한다(SHALL). 대상 저장소 지시가 다른 기획 절차를 정하면 그 지시를 우선해야 한다(SHALL). 원문을 요약·번역해 `intake`해서는 안 된다(MUST NOT).

#### Scenario: workspace 있음
- **WHEN** `product/`가 있는 저장소에서 사용자가 새 기능 아이디어를 말한다
- **THEN** Agent는 묻지 않고 원문을 `intake`하고 `clarify`를 실행한다

#### Scenario: workspace 없음
- **WHEN** `product/`가 없는 저장소에서 사용자가 새 기능 아이디어를 말한다
- **THEN** Agent는 ProductKit으로 정의할지 한 번 묻고, 수락 전에는 `init`하지 않는다

#### Scenario: 제외 대상
- **WHEN** 사용자가 버그 수정이나 작은 문구 수정을 요청한다
- **THEN** Agent는 ProductKit을 제안하지 않는다

### Requirement: 계산 helper는 CLI로 제공한다

`productkit compute`는 `steps-hash <clarification.yaml>`, `entry-hash <json|->`, `atomicity-final <json|->`를 제공해야 한다(SHALL). 결과는 같은 이름의 라이브러리 함수와 같아야 한다(SHALL). 단계 Skill은 계산 예시로 `import('productkit')`를 써서는 안 된다(MUST NOT).

#### Scenario: 대상 앱에서 계산
- **WHEN** 전역 설치 환경의 대상 앱에서 `productkit compute steps-hash product/discovery/CLR-001.yaml`을 실행한다
- **THEN** `stepsContentHashFromYaml` 결과와 같은 hex digest를 출력한다

#### Scenario: 잘못된 입력
- **WHEN** 파일이 없거나 JSON이 아니거나 스키마에 맞지 않는다
- **THEN** 사유를 출력하고 exit 2로 끝난다
