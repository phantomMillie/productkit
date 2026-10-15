<div align="center">

# ProductKit

**"깔끔하게 해줘"라고 했는데, 생각한 거랑 다르게 나온 적 있죠?**

말은 생각보다 정확하지 않아요. 같은 말도 듣는 사람마다 다르게 알아듣거든요.<br>
ProductKit은 아이디어에서 이렇게 해석이 갈리는 곳을 찾아서, 사람이 직접 하나로 정하게 도와줘요.

Claude Code나 Codex에서 쓰는 로컬 CLI와 Agent Skills예요. AI는 질문하고, 따져 보고, 선택지를 내밀어요. 고르는 건 사람이 해요. 누가 뭘 왜 골랐는지는 파일로 남아요.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-339933.svg)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/tag/gilgim/productkit?label=release)](https://github.com/gilgim/productkit/tags)

[English](README.md) · 한국어

</div>

---

## 말은 생각보다 정확하지 않아요

일 맡길 때 이런 말 자주 하잖아요.

> 이 화면 깔끔하게 해줘. 나머지는 알아서 잘 해줘.

말하는 사람 머릿속에는 그림이 있어요. 그런데 듣는 사람은 이걸 여러 가지로 알아들을 수 있어요. (설명하려고 만든 예시예요.)

| 말 | 이렇게도, 저렇게도 들려요 |
|---|---|
| 깔끔하게 | 요소를 줄인다 / 여백이랑 정렬을 다듬는다 / 색을 맞춘다 / 코드를 정리한다 |
| 알아서 | 보이는 부분만 / 관련 기능까지 / 막히면 물어본다 / 안 묻고 진행한다 |
| 잘 | 빠르게 / 안전하게 / 예쁘게 / 원래 하던 대로 |

사람끼리면 "깔끔하게가 어떤 거요?" 하고 다시 물어보면 돼요. 근데 AI는 잘 안 물어봐요. 그럴듯한 걸 하나 골라서 그냥 채워 버리죠. 결과물은 멀쩡해 보이니까 틀린 줄도 몰라요. 그러다 몇 주 지나면, 이게 누가 정한 건지 AI가 짐작한 건지 아무도 기억을 못 해요.

## 그래서 만들었어요

ProductKit이 아이디어를 대신 내주지는 않아요. **사람이 대충 말한 아이디어에서 비어 있는 틈을 찾아 메워 주는 도구예요.** 정확히는, AI가 그 틈을 혼자 메우지 못하게 막고 사람이 직접 메우게 해요.

- 해석이 갈리는 곳이 나오면 AI가 하나를 고르지 않고 질문으로 남겨요. 이게 `FND-xxx` Finding이에요.
- 그중 뭘 고를지는 사람이 정해요. 이유까지 말해야 `DEC-xxx` Decision으로 기록돼요.
- 단계가 끝났는지는 CLI가 확인해요. AI가 "다 했어요" 해도 CLI가 통과시켜 주지 않으면 안 끝난 거예요.

## 틈은 이렇게 찾아요

한 줄짜리 아이디어를 넣으면 이 순서로 하나씩 짚어 봐요.

1. **원문 저장** (`intake`). 해석하기 전에 한 말을 그대로 저장해 둬요. 뒤에 나오는 내용은 전부 원문의 어느 부분에서 나왔는지 따라갈 수 있어요.
2. **단어 뜻 정하기.** "깔끔하게"가 무슨 뜻인지 적어요. 이때 사람이 직접 말한 뜻(`user_stated`)이랑 AI가 짐작한 뜻(`ai_inferred`)을 따로 표시해요.
3. **문장 쪼개기.** 한 문장에 여러 요청이 섞여 있으면 하나씩 나눠요. "깔끔하게 해줘"랑 "알아서 해줘"는 다른 요청이니까요.
4. **빈칸 찾기.** 누가, 뭘, 언제, 어떻게 하는지 채워 봐요. 안 채워지는 칸이 바로 틈이에요.
5. **서로 부딪히는지 보기.** 나눈 요청끼리 충돌하거나 엮여 있지 않은지 확인해요.
6. **다르게 읽히는지 보기.** 같은 말을 다르게 알아들을 수 있는 곳을 찾아서 가능한 해석을 전부 적어요. 여기서는 하나를 고르지 않아요. 고르는 건 사람 몫이라 Finding으로 넘겨요.
7. **"이렇게 이해했는데 맞아요?"** AI가 이해한 내용을 원문 옆에 나란히 보여 주고 확인을 받아요. 사람이 맞다고 해야 이 단계가 끝나요.

그다음엔 갈린 해석을 하나씩 정리해요.

```text
FND-003  "깔끔하게"의 기준이 없음   → 해석 3개 (요소 줄이기 / 여백·정렬 / 색 맞추기)
   ↓ Proposal: 안마다 장점·비용·위험을 같이 보여 줌
DEC-005  "화면 요소만 줄이기"       → 사람이 고름, 이유도 같이 기록
```

중요한 Finding(Critical)이 하나라도 남아 있으면 정의를 확정할 수 없어요. 정해진 내용은 전부 Definition → Decision → 원문 순서로 거슬러 올라가 볼 수 있고요.

### 한번 메운 틈이 다시 벌어지지 않게

- AI가 짐작한 건 결정으로 안 쳐요. `DEC-xxx`는 사람이 직접 말했을 때만 생겨요.
- 승인한 다음에 내용이 바뀌면 그 승인은 무효가 돼요. 다시 확인받아야 해요.
- CLI 안에는 AI가 없어요. CLI는 파일을 저장하고 형식이 맞는지 검사하는 일만 해요. 생각하는 건 지금 쓰고 있는 Claude Code나 Codex가 하니까, API 키를 따로 넣을 필요도 없고 몰래 모델을 부르는 일도 없어요.

## 동작 방식

<p align="center"><img src="docs/assets/how-it-works.ko.svg" alt="ProductKit 동작 방식: 사람이 결정하고, 에이전트가 추론하고, CLI가 판정·기록한다" width="100%"></p>

사람은 고르고, AI는 묻고 생각하고, CLI는 끝났는지 확인하고 기록해요.

## 빠른 시작

Node.js 20.19 이상이랑 Git이 있어야 해요.

```bash
npm install --global "git+https://github.com/gilgim/productkit.git#v0.1.0-beta.1"
productkit --version        # 0.1.0-beta.1
```

> npm에 있는 `productkit`은 이름만 같은 다른 프로젝트예요. 그래서 위처럼 GitHub 태그로 설치해야 해요.

앱 폴더에서 workspace를 만들고 아이디어를 넣어요.

```bash
cd ~/projects/my-app
productkit init
productkit intake "<모호함을 걷어낼 아이디어 한 줄>"
productkit clarify
```

`clarify`를 실행해도 내용을 대신 써 주지는 않아요. AI가 다음에 뭘 해야 하는지만 알려 줘요.

```text
Prompt saved: PRM-001
  product/sources/PRM-001.yaml

AI action required: Clarification has not started.
  Prompt:      product/sources/PRM-001.yaml
  Instruction: skills/clarify/SKILL.md
  Write to:    product/discovery/CLR-001.yaml
  Bind prompt_ref + prompt_content_hash in the clarification and new confirmation; do not invent user agreement.
```

일이 진짜 끝나기 전에는 검사를 통과하지 못해요.

```text
$ productkit validate
PRODUCT READINESS BLOCKED
FAIL definition.required: Product Definition is missing.
```

Claude Code나 Codex가 단계마다 일을 할 수 있게 Skill을 연결해요([설치 가이드](docs/installation.md)).

```bash
PRODUCTKIT_ROOT="$(npm root -g)/productkit"
mkdir -p .claude/skills
for skill in clarify model graph challenge propose define validate; do
  ln -s "$PRODUCTKIT_ROOT/skills/$skill" ".claude/skills/$skill"
done
```

그다음 Claude Code에서 `/clarify`라고 입력하고 질문에 답하면 돼요. 정의가 승인되면 OpenSpec으로 내보낼 수 있어요.

```bash
productkit export openspec --change <change-id> --capability <capability-id>
```

`export openspec`을 쓰려면 workspace에 OpenSpec CLI가 깔려 있어야 해요. 자세한 건 [설치 가이드](docs/installation.md#productkit-and-openspec)를 봐 주세요.

## 만들어지는 것

`productkit init`을 하면 그냥 파일로 된 workspace가 생겨요. Markdown이랑 YAML이라 diff도 보이고 PR로 리뷰도 할 수 있어요.

```text
product/
├── sources/      아이디어 원문 (손대지 않고 그대로)
├── discovery/    누가·무엇을·왜·어떤 흐름으로
├── nodes/        더 못 쪼갤 만큼 나눈 요구사항
├── graph/        요구사항끼리의 관계와 영향
├── findings/     허점·가정·모순 (갈린 해석은 여기 남아요)
├── proposals/    장점·비용·위험을 같이 적은 선택지
├── decisions/    사람이 직접 고른 것 + 이유
├── journeys/  policies/  assumptions/
├── validations/  semantic-reviews/  approvals/
└── exports/      OpenSpec으로 내보낸 기록
```

## 원칙

ProductKit에는 원칙이 10개 있어요([CONSTITUTION.md](CONSTITUTION.md)). 그중 제일 중요한 것만 추리면 이래요.

1. AI가 짐작한 걸 사람이 정한 것처럼 기록하지 않아요.
2. 애매한 건 짐작으로 메우지 않고 Finding으로 남겨요.
3. 모든 결정에는 이유가 있어야 해요.
4. 정의에 들어간 내용은 전부 원래 아이디어까지 따라갈 수 있어야 해요.
5. 선택지를 보여 줄 때는 좋은 점만이 아니라 비용이랑 위험도 같이 보여 줘요.
6. 해결 안 된 Critical Finding이 있으면 정의를 확정하지 않아요.
7. 제품 정의랑 구현 명세는 따로 가요. DB 스키마나 API를 지어내지 않아요.

## 한계

- 아직 **v0 베타**예요. 파일·스키마·검사·해시 같은 구조는 자동 테스트 248개로 확인하고 있어요.
- 애매한 걸 없앴다고 제품이 맞는 건 아니에요. 검사를 통과했다는 건 **형식**이 맞다는 뜻이에요. 갈리는 해석을 얼마나 잘 찾아내는지는 AI랑 사람한테 달려 있어요.
- CLI는 확인이나 승인을 누가 입력했는지까지는 알 수 없어요. 그러니까 사람이 실제로 말한 다음에만 결정이랑 승인을 기록해 주세요.

## 문서

| | |
|---|---|
| [CLI 레퍼런스](docs/cli.md) | 모든 명령·옵션·종료 코드 |
| [아키텍처](docs/architecture.md) | 역할 분리, 저장 구조, 검사 |
| [Artifact 계약](docs/artifact-contracts.md) | 필드 단위 스키마 |
| [설치 가이드](docs/installation.md) | 태그 고정 설치, Skill, OpenSpec |
| [로드맵](docs/roadmap.md) | Change 01~09 |

## 개발

```bash
git clone https://github.com/gilgim/productkit.git && cd productkit
npm install && npm run build
npm test
```

이슈랑 PR은 언제든 환영해요. ProductKit 자체도 OpenSpec(`openspec/changes/`)으로 개발하고 있어요.

## 라이선스

[MIT](LICENSE)
