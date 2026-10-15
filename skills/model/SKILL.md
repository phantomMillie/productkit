# Model Skill

ProductKit의 Phase 3(Atomic Node Modeling) instruction이다. Claude Code와
Codex가 공유한다. CLI는 이 내용을 생성하지 않는다 — 이 instruction을 읽고
따르는 건 Agent의 일이다.

## 목적

확정된(`confirmed`) Clarification의 `steps.decomposition`을 단일 검증
대상·분해 가능성·의미 보존 세 기준으로 평가해 원자적 Node로 변환하고,
누락·추가·조건 변경·논리 연산자 변경·왜곡을 구분해 기록한다.

## 진입 조건과 실패 시 대안

1. `productkit model` 실행 결과가 "does not exist"(nodes/ 없음) → 이
   workspace는 Change 03 이전에 만들어진 것이다. `productkit init`을 다시
   실행하라고 안내한다(기존 파일은 안 건드리고 `nodes/`만 추가된다).
2. "No Clarification found" → `productkit intake`와 `productkit clarify`를
   먼저 실행하라고 안내한다.
3. "is not confirmed yet" → 해당 Clarification의 `productkit clarify`를
   먼저 끝내라고 안내한다. **confirmed가 아닌 Clarification으로 Node를
   만들지 않는다.**
4. 위 경우가 아니면 CLI가 안내하는 입력(Clarification)·출력(NodeGroup)
   경로를 그대로 따른다.

## 입력 파일

- `product/discovery/CLR-xxx.yaml` — confirmed 상태인 Clarification. **수정
  하지 않는다.**

## 출력 파일

- `product/nodes/NDG-xxx.yaml`(xxx는 입력 Clarification과 같은 번호) — 아래
  schema를 따르는 YAML 하나.

```yaml
id: NDG-001
clarification_ref: CLR-001
source_content_hash: "<productkit compute steps-hash product/discovery/CLR-001.yaml>"
clarification_content_hash: "<productkit compute clarification-content-hash product/discovery/CLR-001.yaml>"
nodes:
  - id: NOD-001-1
    kind: fact | inference | requirement | policy
    statement: "..."
    origin: source | inference
    derived_from:
      clarification_ref: CLR-001
      decomposition_index: 0   # steps.decomposition 배열의 0-based 인덱스
    structural_signal: <productkit compute structural-signal 결과 JSON>
    atomicity:
      single_verifiable_subject: { verdict: "yes", reason: "..." }
      decomposability: { verdict: "not_applicable", reason: "..." }
      meaning_preservation: { verdict: "preserved", confidence: "high", reason: "..." }
      final: atomic   # productkit compute atomicity-final 결과 — 아래 "원자성 판정" 참고
  - id: NOD-001-3          # 분해로 새로 만든 Node
    split_from: NOD-001-2  # retired_nodes 의 원래 Node
    # ... 나머지 필드는 위와 같다. derived_from 은 원래 Node와 같은 CLR·index
retired_nodes:            # 분해했을 때만. split_required 로 판정된 원래 Node를 그대로 남긴다
  - id: NOD-001-2
    # ... atomicity.final: split_required, 자식(split_from 이 이 id인 Node)이 2개 이상
coverage:
  complete: true
  uncovered_decomposition_indices: []
distortion_checks:        # decomposition 항목마다 정확히 하나
  - decomposition_index: 0
    reconstructed_statement: "..."
    condition_preservation: { verdict: preserved | not_applicable, reason: "..." }
    operator_preservation: { verdict: preserved | not_applicable, reason: "..." }
    exception_preservation: { verdict: preserved | not_applicable, reason: "..." }
    verdict: preserved | distorted | uncertain
    confidence: low | medium | high
    reason: "..."
finding_candidates: []   # 아래 "위험 신호" 참고
status: in_progress   # in_progress | needs_review | modeled — CLI가 다시 계산하므로 직접 믿지 않음
```

## 완료 검사 규칙 (CLI가 실제로 보는 것)

`productkit model`은 아래를 모두 검사한다.

- `source_content_hash`는 현재 Clarification `steps`의 해시(`productkit compute
  steps-hash`)와 같다. `clarification_content_hash`는 Clarification 전체(상태 제외)의
  해시(`productkit compute clarification-content-hash`)와 같다. Clarification을 다시
  확인받으면 이 값도 바뀐다.
- 입력 Clarification이 confirmed다.
- Node id는 `nodes`·`retired_nodes`를 통틀어 겹치지 않는다. `statement`와 세 판정의
  `reason`은 자리표시 값이 아니다(clarify Skill의 목록과 같다).
- `origin: source`인 Node가 가리키는 decomposition 항목에는 `span_refs`가 있어야 한다.
- 모든 decomposition 항목을 `nodes` 중 하나 이상이 덮는다(`retired_nodes`는 세지 않는다).
- `nodes`의 `final`은 모두 `atomic`이고, 세 판정에서 다시 계산한 값과 같다.
- 분해했으면: 원래 Node는 `final: split_required`로 `retired_nodes`에 남고, 새 Node
  2개 이상이 `split_from`으로 그 Node를 가리키며 같은 CLR·`decomposition_index`를
  가진다. `split_from` 고리는 순환하면 안 된다.
- `distortion_checks`는 decomposition 항목마다 정확히 하나이고, 세 보존 검토
  (`condition_preservation`·`operator_preservation`·`exception_preservation`)가 모두
  `preserved` 또는 `not_applicable`이며 `reason`이 있다. `verdict`는 `preserved`여야
  완료된다(`distorted`·`uncertain`은 막힌다).
- 열린(`open`) `addition`·`condition_change`·`operator_change`·`distortion` 후보가 없다.

## 원자성 판정 — 세 기준을 순서대로 평가한다

1. **단일 검증 대상**(`single_verifiable_subject`): 이 decomposition 항목이
   독립적으로 관찰 가능한 결과를 하나만 담는가? 둘 이상이면 `no`.
2. **분해 가능성**(`decomposability`): `no`라면, 쪼갠 조각이 서로 없이도
   의미 있게 성립하는가? 조각이 서로의 전제조건이면(예: 복합 조건 정책)
   `would_orphan_pieces` — 분해하지 않는다. 각자 독립적으로 성립하면
   `valid_split`.
3. **의미 보존**(`meaning_preservation`): 분해했든 유지했든, 공유된
   조건·트리거를 빠짐없이 전달하는가?

**`final`을 직접 지어내지 않는다.** `productkit` CLI는 NodeGroup 파일을 쓰지
않으므로(읽고 판정만 한다), `final`도 AI가 채워야 한다 — 단, 값을 스스로
고르지 말고 위 세 필드값을 그대로 `productkit compute atomicity-final`에 넣어
나온 결과를 적는다(패키지의 `evaluateAtomicityFinal()`을 부른다. 전역 설치에서는
`import('productkit')`가 동작하지 않으니 쓰지 않는다):

```sh
productkit compute atomicity-final - <<'JSON'
{
  "single_verifiable_subject": { "verdict": "yes", "reason": "..." },
  "decomposability": { "verdict": "not_applicable", "reason": "..." },
  "meaning_preservation": { "verdict": "preserved", "confidence": "high", "reason": "..." }
}
JSON
```

`productkit model`은 이 값을 **다시 계산해서 대조**한다 — 세 필드와 안 맞는
`final`을 적으면(직접 판단해서 끼워 넣으면) `atomicity_final_mismatch`로
거부된다. AI는 세 필드의 `verdict`/`reason`/`confidence`만 성실하게 채우고,
`final`은 반드시 함수 결과를 그대로 옮겨 적는다.

**반례 두 가지를 반드시 구분한다**:
- 독립적인 여러 행동(예: "결제가 완료되면 주문을 확정하고, 이메일을 보내고,
  재고를 차감한다") → 행동별로 분해하되, 각 Node가 공유 트리거("결제가
  완료되면")를 자신의 statement에 그대로 포함해야 한다. 트리거를 빠뜨리면
  의미 보존 실패다.
- 복합 조건 정책(예: "3회 이상 실패했고 최근 1시간 이내면 계정을 잠근다") →
  조건을 쪼개지 않고 하나의 `policy` Node로 유지한다.

판정이 불확실하면(`uncertain`) 임의로 `atomic`을 적지 않는다 — 아래 위험
신호 절차를 따른다.

## 위험 신호 — 네 가지는 전체 확정을 막는다

다음을 감지하면 `finding_candidates`에 `status: open` 항목을 추가한다.
Node별 재확인은 생략하지만(일상적 분해는 그냥 진행), 아래 네 가지는 해소
전까지 `NodeGroup`이 `modeled`가 될 수 없다 — Clarification이 confirmed라는
사실이 이 네 가지를 자동으로 덮어주지 않는다.

- `addition`: Node statement에 출처 decomposition 항목에 없던 어휘가 많다
  (CLI가 어휘 중복률로 후보를 미리 표시해 준다).
- `condition_change`: 조건의 범위가 넓어지거나 좁아지거나 다른 조건으로
  바뀌었다.
- `operator_change`: AND/OR/NOT 결합이 바뀌었다(예: "이고"→"이거나").
- `distortion`: 역-합성 문장이 원래 의미와 달라 보인다.

이 네 가지가 아닌 일반 모호성(단순 용어 확인 등)은 완료를 막지 않는다 —
전부 막으면 Node마다 사람 확인을 또 받는 것과 같아져서 Clarification에서
이미 끝난 동의를 무의미하게 만든다.

## 금지 행동

- 문장 길이만 줄이는 것을 원자화로 취급하지 않는다.
- `derived_from` 없이 Node를 만들지 않는다.
- Node가 Prompt를 직접 가리키는 필드를 만들지 않는다(Clarification까지만,
  Prompt는 체인으로 조회).
- 위험 신호를 발견하고도 `status: resolved`로 스스로 적지 않는다 — 해소는
  이 change의 범위가 아니다(Change 05~06).
- CLI가 계산해야 할 `final`, `coverage`, 해시 일치 여부를 AI가 대신 적어
  넣지 않는다.

## 완료 조건

`productkit model`을 실행했을 때 "NodeGroup modeled"로 보고되는 것만이
완료다. 그 전까지는 몇 번이든 다시 시도할 수 있다.

## 후속 검증 방법

```sh
productkit model [--clarification CLR-xxx]
```

이 명령이 완료 여부와 막힌 이유(커버리지 누락/원자성 미확정/열린 위험
신호/소스 변경)를 그대로 알려준다. "modeled" 보고도 구조적 일관성만 확인한
것이지 의미가 옳다는 증명이 아니다.
