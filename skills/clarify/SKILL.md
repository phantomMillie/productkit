# Clarify Skill

ProductKit의 Phase 2(Clarification) instruction이다. Claude Code와 Codex가 공유한다.
`docs/architecture.md` 3장의 원칙 그대로 CLI는 이 내용을 생성하지 않는다 — 이
instruction을 읽고 따르는 건 Agent의 일이다.

## 목적

`product/sources/`에 저장된 프롬프트 원문을 정의·분해·구체화·관계검증·반례검증·
해석확인 6단계로 명료화해, 원문과 추론이 분리되고 사용자가 명시적으로 확인한
Clarification artifact를 만든다.

## 진입 조건과 실패 시 대안

이 Skill은 Claude Code의 네이티브 자동선택 기능 없이도 동작해야 한다 — 사용자가
자연어로 아이디어를 설명하면 Agent가 직접 판단해 아래 명령을 실행한다. 아이디어를
처음 받는 진입 흐름은 `skills/productkit/SKILL.md`(설치 시 `productkit setup`이
Agent에 연결)가 맡는다.

1. `productkit` 명령을 찾을 수 없다 → 사용자에게 설치를 안내한다(`README.md`
   참고). 이 instruction을 더 진행할 수 없다.
2. `productkit clarify` 실행 결과가 "No ProductKit workspace found" → 사용자에게
   ProductKit으로 정의할지 한 번 묻고(`product/` 폴더가 생긴다고 알린다), 수락하면
   `productkit init`을 실행한다.
3. `productkit clarify` 실행 결과가 "No prompt found" → 사용자 발화 원문을 그대로
   임시 파일에 쓰고 `productkit intake --file <파일>`로 저장한다. 요약·번역하지
   않는다.
4. 위 세 경우가 아니면 CLI가 안내하는 입력 경로·출력 경로를 그대로 따른다.

## 입력 파일

- `product/sources/PRM-xxx.yaml` — 프롬프트 원문(`raw_text`), span 목록. **수정하지
  않는다.**

## 출력 파일

- `product/discovery/CLR-xxx.yaml` (xxx는 입력 Prompt와 같은 번호) — 아래 schema를
  그대로 따르는 YAML 하나.

```yaml
id: CLR-001
prompt_ref: PRM-001
prompt_content_hash: <PRM-001.yaml의 content_hash 그대로>
steps:
  definition: []        # [{term, meaning, origin: user_stated | ai_inferred}]
  decomposition: []     # [{statement, span_refs: [Prompt의 spans id, ...]}]
  elaboration: []        # [{statement, actor?, object?, condition?, action?, result?}]
  relation_check: []     # [{statement_a, statement_b, relation_candidate}]
  counterexample: []     # [{ambiguity, possible_interpretations: [...]}]
status: in_progress      # in_progress | awaiting_confirmation | confirmed
interpretation_check: [] # 아래 "해석 확인" 참고 — 이력 목록, 과거 항목 수정 금지
finding_candidates: []   # [{statement, type: ambiguity|contradiction|missing_premise, span_refs}]
```

## 필수 필드와 금지 행동

- `definition[].origin`은 반드시 `user_stated`(사용자가 직접 말함) 또는
  `ai_inferred`(AI 추론)여야 한다. AI가 추측한 정의를 `user_stated`로 적지
  **않는다**.
- `decomposition[].span_refs`는 입력 Prompt의 `spans` id를 가리켜야 한다. Prompt에
  없는 내용을 새로 지어내 넣지 않는다.
- 모호성이나 모순을 발견하면 임의로 하나를 골라 확정하지 않고
  `finding_candidates`에 남긴다. **추측으로 메우지 않는다.**
- `relation_check`는 참고 메모일 뿐이다. 확정된 관계(Graph edge)인 것처럼
  취급하지 않는다 — 그건 이후 Change의 범위다.
- CLI가 완료를 판정한다. 이 파일에 `status: confirmed`라고 적는다고 해서
  완료로 인정되지 않는다 — `productkit clarify`를 다시 실행해 실제 판정을
  확인한다.
- YAML 문자열 안에 인용부호(`"..."`)를 그대로 넣지 않는다. `"마감일이 지나면"`
  처럼 겹따옴표로 특정 표현을 인용하면 YAML 파싱 오류가 난다(실제로 겪은
  문제). 따옴표 없이 쓰거나, 정 필요하면 YAML 작은따옴표 규칙(`''`로 이스케이프)
  을 따른다.

## 해석 확인 (완료의 핵심 조건)

1. `steps`를 바탕으로 사용자 의도를 논리 구조 그대로 재구성한 문장을 만들어
   (`presented_statement`) 원문과 나란히 사용자에게 보여주고 동의를 구한다.
2. `steps` 전체를 정규화(키 정렬 JSON)해 해시한다. `productkit compute
   steps-hash`를 그대로 쓴다 — 직접 구현하거나 다른 YAML 파서를 따로 불러오지
   않는다(해시 방식이 CLI의 검증 로직과 반드시 같아야 하기 때문). 이 명령은
   패키지의 `stepsContentHashFromYaml`을 부른다. 전역 설치에서는
   `import('productkit')`로 패키지를 찾을 수 없으니 쓰지 않는다. 예:

   ```sh
   productkit compute steps-hash product/discovery/CLR-001.yaml
   ```

3. 사용자의 실제 응답을 받는다 — `agreed`, `disagreed`, `partially_agreed` 중
   하나와 **실제 발언 원문**(`user_statement`, 반드시 채운다).
4. 새 `interpretation_check` 항목을 **추가**한다(기존 항목을 고치지 않는다):

   ```yaml
   - id: IC-001
     presented_statement: "..."
     presented_hash: "<2번에서 계산한 해시>"
     prompt_ref: PRM-001
     prompt_content_hash: "<PRM-001.yaml의 content_hash>"
     user_response: agreed
     user_statement: "<사용자의 실제 발언>"
     checked_at: "2026-10-12T00:00:00Z"
     entry_hash: "<productkit compute entry-hash 결과>"
   ```

   `prompt_ref`·`prompt_content_hash`는 Clarification 최상위 값과 같아야 한다. 빠지면
   완료 판정이 `invalid_prompt_reference`로 막힌다.

   `entry_hash`는 `entry_hash`만 뺀 나머지 필드 전부(**`id` 포함**)를 JSON으로
   넘겨 `productkit compute entry-hash`로 계산한다. CLI 판정도 같은 필드로 다시
   계산한다. 예:

   ```sh
   productkit compute entry-hash entry.json   # 또는 - 로 stdin
   ```
5. 사용자가 동의하지 않으면 관련 단계를 다시 수행하고 2~4를 반복한다. **기존
   `interpretation_check` 항목은 그대로 둔다.**
6. `steps`를 수정한 뒤에는 이전 `interpretation_check`가 더는 현재 내용을
   대표하지 않는다 — 반드시 새 라운드로 다시 확인받는다.

**중요한 한계**: 이 해시들은 "기록이 바뀌지 않았는지" 확인하는 용도일 뿐이다.
사용자가 실제로 그렇게 말했는지, 또는 누군가 파일을 직접 고쳤는지를 막거나
증명하지 않는다 — 들키지 않고 고칠 수 없게 할 뿐, 고치는 행위 자체를 막지는
못한다.

## 질문 조건

반례 검증에서 모호성을 발견했거나, 구체화에 필요한 정보(주체·대상·조건·행동·
결과)가 원문에 없을 때 사용자에게 질문한다. "더 자세히 알려주세요" 같은
일반적인 질문은 반복하지 않는다 — 구체적으로 무엇이 불명확한지 말한다.

## 완료 조건

`productkit clarify`를 실행했을 때 "Clarification confirmed"로 보고되는 것만이
완료다. 그 전까지는 몇 번이든 다시 시도할 수 있다.

## 후속 검증 방법

```sh
productkit clarify
```

이 명령이 완료 여부와 그 이유(미확인/해시불일치/무결성위반 등)를 그대로
알려준다. AI는 이 출력을 신뢰하되, 이 출력 자체도 "기록이 무결하다"는 뜻이지
"사용자가 실제로 동의했음을 증명한다"는 뜻이 아님을 기억한다.
