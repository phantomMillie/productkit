---
name: productkit
description: Offer ProductKit when the user brings a new product or feature idea, a still-vague requirement, or asks to define, plan or spec what to build (e.g. "이런 기능 만들자", "아이디어가 있는데", "기획/정의로 정리해줘", "let's build X"). If the repository already has a product/ workspace, start right away by saving the user's own words with productkit intake; otherwise ask once whether to use ProductKit before running productkit init. Do not offer it for bug fixes, small copy or style edits, questions, or work whose spec is already settled.
---

# ProductKit 진입

ProductKit은 자연어 아이디어에서 해석이 갈리는 곳을 찾아 사람이 직접 정하게 하고, 그 근거를 대상 저장소의 `product/` 아래 파일로 남기는 CLI다. CLI는 LLM을 부르지 않는다. 묻고 따지는 것은 Agent, 고르는 것은 사람, 단계가 끝났는지 판정하는 것은 CLI다.

## 언제 제안하나

- 제안한다: 새 제품·기능 아이디어, 무엇을 만들지 아직 모호한 요구, 정의·기획·명세로 정리하자는 요청.
- 제안하지 않는다: 버그 수정, 문구·스타일 같은 작은 수정, 질문·설명 요청, 명세가 이미 정해진 구현.
- 저장소 지시 파일(`CLAUDE.md`, `AGENTS.md` 등)이 다른 기획 절차를 정해 두었으면 그 절차가 먼저다. 그때는 "ProductKit으로도 정의할 수 있다"고 한 줄만 제안하고, 사용자가 고를 때만 쓴다.

## 시작

1. `productkit --version`이 실패하면 설치 방법(README)만 안내하고 멈춘다.
2. 저장소 루트(보통 git 루트)에 `product/`가 있는지 본다.
   - 있다: 묻지 않고 3으로 간다.
   - 없다: 한 번 묻는다. "이 아이디어를 ProductKit으로 정의할까요? 저장소에 `product/` 폴더가 생깁니다." 수락하면 저장소 루트에서 `productkit init`을 실행한다. 거절하면 원래 하던 방식으로 진행하고, 같은 대화에서 같은 아이디어로 다시 묻지 않는다.
3. 사용자 발화를 원문 그대로 임시 파일(저장소 밖, 예: OS 임시 폴더)에 쓰고 `productkit intake --file <파일>`로 저장한다.
   - 요약·번역·맞춤법 교정·정리를 하지 않는다. 원문은 이후 모든 판단의 근거다(`product/constitution.md` 4).
   - 아이디어가 여러 메시지에 걸쳐 있으면 해당 메시지들을 순서대로, 빈 줄로 구분해 그대로 이어 붙인다. 어느 메시지를 넣었는지 사용자에게 한 줄로 알린다.
4. `productkit clarify`를 실행하고, 출력의 `Instruction:` 경로에 있는 SKILL.md를 읽어 그대로 따른다.

## 이어 하기

`product/`에 진행 중인 작업이 있으면 단계 이름을 짐작하지 않는다. `productkit clarify`, `productkit model`, `productkit graph` 순서로 상태를 보고, 처음으로 완료가 아닌 단계의 출력이 안내하는 Instruction을 따른다. 그 뒤 단계(challenge, propose, define, validate)도 CLI 출력의 안내를 기준으로 한다.

## 지킬 것

- CLI가 완료라고 판정하기 전에는 단계를 끝난 것으로 보고하지 않는다.
- 사용자가 실제로 말하지 않은 동의·결정·승인을 기록하지 않는다.
- 해시나 판정 값이 필요하면 `productkit compute <helper>`를 쓴다(`steps-hash`, `entry-hash`, `atomicity-final`). 전역 설치에서는 `import('productkit')`가 동작하지 않는다.
