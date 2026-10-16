---
name: Project IDEA
description: A continuous left-to-right knowledge space with a single prompt and inspectable evidence.
colors:
  primary: "#4285F4"
  red: "#EA4335"
  yellow: "#FBBC05"
  green: "#34A853"
  canvas: "#F7F9FC"
  surface: "#FFFFFF"
  ink: "#202124"
  muted: "#5F6368"
  border: "#DADCE0"
  portalDark: "#18212C"
typography:
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
rounded:
  card: 16px
  control: 12px
---
# Project IDEA — DESIGN.md
## Overview
IDEA는 사용자가 질문하고 원천 지식과 관계를 탐색하는 단일 화면 도서관이다. 화면의 본체는 **좌측 Black Hole → 중앙의 여러 회전 계층과 지식 공간 → 우측 White Hole**이 이어지는 연속된 3D 장면이다. 양쪽 포털은 처음부터 동시에 보이며, 중앙의 구형 그래프에 장식 두 개를 붙이는 구성으로 바꾸지 않는다.
원문이 들어오는 곳, 지식과 연결·검토되는 곳, 승인된 Wiki가 나타나는 곳을 공간으로 구분한다. 전문적인 연구 작업 화면이되 차갑고 복잡한 모니터링 대시보드처럼 만들지 않는다. 관찰할 때는 공간감, 읽고 판단할 때는 가독성이 우선한다.
이 문서는 제품이 보여야 할 형태와 동작을 정한다. 라이브러리와 컴포넌트 내부 구조는 구현 담당자에게 맡긴다. 아래 색상·간격은 구현을 시작하기 위한 제안값이며, 좌우 구도와 핵심 동작이 제품의 고정 조건이다.
## Colors
밝은 바탕에 Google-inspired Blue·Red·Yellow·Green을 제한적으로 사용한다. Google 제품이라는 인상을 주는 로고·보증 문구는 사용하지 않는다.
| 역할 | 사용 원칙 |
|---|---|
| Blue | 입력·선택·주요 행동 |
| Red | 의미 정렬층의 식별 강조. 오류는 반드시 오류 아이콘·문구를 함께 표시 |
| Yellow | 검토·보류·주의 |
| Green | 사용자 승인 후 실제 적용된 상태 |
| Ink / muted | 본문·레이블. 밝은 강조색을 작은 본문의 유일한 색으로 쓰지 않음 |
| Dark portal / luminous surface | 왼쪽 흡수구의 어두운 중심과 오른쪽 출력구의 밝은 중심 |
노드 종류는 모양·레이블로도 구분한다. 색상 하나로 “진실”, “안전”, “검증 완료”를 단정하지 않는다. 배경·레이블·선택 표시의 대비는 실제 렌더링에서 확인한다.
## Typography
문서와 검사 결과는 DOM 카드의 읽기 쉬운 본문으로 표시한다. 긴 글을 3D 텍스처로 만들어 읽게 하지 않는다. 글꼴은 먼저 사용할 수 있는 시스템 글꼴을 사용하며, 새 폰트 도입은 요구사항이 아니다.
구조 레이블은 `Source`, `Terms`, `Knowledge`, `Wiki`처럼 짧게 쓴다. 업무 UI의 기본 문구는 영어로 두되 사용자의 질문·자료 언어를 보존한다. 화면에 의미 없는 큰 제목, 설명 섹션, 영문 슬로건을 반복하지 않는다.
기본 안내 문구: `Ask your knowledge, or paste a source URL…` / `Session only — refreshing may reset this library.`
## Layout
### Main scene
데스크톱 기본 시점에서 왼쪽에 Black Hole, 가운데에 좌→우 축을 따라 배치된 여러 회전 궤도·계층, 오른쪽에 White Hole을 둔다. 깊이는 하나의 3D 공간 안에서 표현하고, 세 구역을 별도 페이지·캔버스·2D 카드로 대체하지 않는다.
기존 지식은 중앙부터 오른쪽 도서관 영역에 남고, 신규 자료와 후보만 그 위에 더해진다. 회전은 실제 계층이 움직이는 것이지 카메라가 전체 그래프 주위를 자동 순회하는 연출로 대체하지 않는다. 가장 높은 층이나 가장 오른쪽 노드가 더 참이라는 의미는 없다.
도식은 배치의 의도를 설명할 뿐, 2D 카드 세 개를 구현하라는 지시가 아니다.
```text
IDEA                                  Session only · execution status

[ BLACK HOLE ] ⇢ [ Terms / knowledge orbits + existing nodes ] ⇢ [ WHITE HOLE ]
   Source URL          candidates · evidence · relations          Wiki changes

                 [ Answer / selected node / review card ]

             [ One prompt: question or URL + question        → ]
```
### Overlay and composition
프롬프트는 하단 중앙에서 항상 접근 가능하게 둔다. 선택 카드와 변경안은 **중앙 하단의 접을 수 있는 오버레이**를 기본으로 한다. 카드가 열리면 필요한 만큼 장면을 위로 재배치하거나 카드 내부를 스크롤한다. 오른쪽 고정 사이드바로 White Hole을 상시 덮지 않는다.
초기 검토 뷰포트는 1366×768과 1440×900이다. 두 홀·프롬프트·승인 행동이 동시에 식별되는지 확인한다. 좁은 화면에서는 상세 카드를 하단 시트로 축소하되 프롬프트와 장면 복귀 버튼을 남긴다.
불필요한 `Library`, `Agents`, `Settings` 페이지나 별도 검색창을 생성하지 않는다. 입력·질문·탐색의 기본 진입점은 한 개의 프롬프트다.
### Camera and motion
기본 시점과 검토 시점에서는 좌우 방향을 유지한다. 탐색 범위를 제한하거나 안전한 포커스 위치를 사용해 양쪽 포털이 사라지거나 뒤집히지 않게 한다. `Reset view`로 항상 기본 구도로 돌아올 수 있어야 한다.
계층은 서로 다른 느린 속도로 회전한다. 노드 선택·원문 읽기·변경안 검토 중에는 자동 회전을 멈춘다. 축소 모션 설정에서는 자동 회전·입자를 끄되 선택·관계·상태를 유지한다. 연결선은 회전한 노드의 실제 위치를 따라가야 한다.
## Elevation & Depth
3D 깊이는 정보의 종류와 관계를 구분하는 데 쓰고, 원문과 해석의 신뢰도 순위로 쓰지 않는다. 가까운 선택 노드와 근거 경로를 강조하고 나머지는 약화하되, 기존 데이터가 사라진 것처럼 보이게 하지 않는다.
카드는 불투명하거나 충분한 대비가 있는 밝은 면을 사용한다. 얇은 테두리와 절제된 그림자로 장면과 구별한다. 블룸·글로우가 글자나 근거 구간을 번지게 만들면 효과를 줄인다.
양쪽 포털의 기본 링·코어와 연결 흐름은 필수다. 사실적인 렌즈 왜곡·고밀도 파티클·물리 시뮬레이션은 선택 사항이며, 읽기와 노드 클릭을 방해해서는 안 된다.
## Shapes
용어·개념·개체·주장·원천 자료를 모두 같은 점으로만 만들지 않는다. 단순한 노드 모양과 타입 레이블을 조합하되, 클릭 영역은 시각적 크기보다 충분히 확보한다.
중앙은 하나의 큰 구가 아니라 **여러 링·띠와 그 사이 연결**로 구성한다. 새로운 지식이 생성되는 과정에서 Source가 영구적으로 소멸하는 모습은 피한다. 원문은 추적 가능한 노드로 남고 그로부터 후보가 파생된다.
카드와 프롬프트는 절제된 둥근 모서리를 사용한다. 승인 버튼은 색상뿐 아니라 명확한 텍스트를 가진다.
## Components
### Prompt and answer
동일한 입력창에서 질문 또는 URL과 질문을 받는다. 입력 내용을 보존하고 처리 중 중복 제출을 막는다. 기존 지식에 대한 답변은 카드와 관련 경로로 보여주고, 그것만으로 그래프를 변경하지 않는다.
새 URL을 처리할 때도 사용자의 질문에 먼저 답할 수 있어야 한다. `Answer`와 `Proposed changes`는 같은 결과 안에서 구분한다. 답변은 확인되지 않은 사실의 확정을 뜻하지 않는다.
### Knowledge Card and evidence
노드를 누르면 설명·유형·관계·출처를 보여준다. Source는 실제 읽은 자료와 구간을, Term은 정의와 별칭·매핑을, Claim은 진술과 조건·근거·검사 상태를, Wiki는 읽기 쉬운 종합 문장을 보여준다.
`Trace to source`를 누르면 Wiki → Claim → Source 경로를 강조하고 실제 원문 구간을 연다. 사용자가 노드를 드래그하거나 카메라를 움직이는 행동을 클릭으로 잘못 처리하지 않는다. `Escape`와 닫기 버튼으로 카드에서 복귀할 수 있어야 한다.
### Knowledge Diff and approval
추가·수정·연결·보류를 구분하고, 기존 문장과 제안 문장을 원문과 함께 확인하게 한다. 승인 가능한 항목과 차단된 항목을 구분한다. `Add to library`는 명시적으로 선택된 유효 변경만 적용한다. 버튼을 누른 사실과 실제 적용 성공을 구분한다.
보류·기계적 검사 실패·미해결 충돌은 완료 영역으로 이동시키지 않는다. 거절은 기존 Wiki를 바꾸지 않는다. 승인 이후에만 해당 Wiki 변경이 오른쪽 White Hole을 통해 나타난다. 원문과 기존 노드는 사라지지 않는다.
### Execution states
| 상태 | 보이는 내용과 동작 |
|---|---|
| Idle / Explore | 기존 지식·예시 표시, 느린 계층 회전, 두 포털과 프롬프트 노출 |
| Query | 기존 승인 지식의 경로 강조와 답변 카드. 편입 애니메이션 없음 |
| Ingest | 실제 수집 중인 URL·자료를 왼쪽 입구에 표시. 읽기 실패를 성공으로 연출하지 않음 |
| Align | 매핑된 기존 노드 강조, 신규 후보·점선 관계 표시 |
| Verify / Repair | 실제 보고받은 검사·수정 상태. 임의의 통과 배지나 가짜 퍼센트 없음 |
| Review | 회전 정지, 원문·변경안 비교. 오른쪽 포털은 계속 보임 |
| Apply | 적용 중임을 표시하고 반복 클릭 방지 |
| Complete | 적용 결과를 받은 뒤 오른쪽 Wiki 변화 표시. 후속 질문 안내 |
| Unresolved / Error | 보류·실패 이유, 기존 지식 유지, 가능한 재시도·닫기 행동 |
백엔드가 단계별 정보를 제공하지 않으면 일반 대기 표시를 사용한다. 최종 결과를 받은 뒤 보여주는 과정 재생은 재생이라고 표시한다. 실제 처리 중인 것처럼 꾸미지 않는다.
### Verification labels
`Source located` / `Quote matched` / `Model-reviewed` / `Needs review` / `Blocked` / `Added to this session`을 필요에 따라 조합한다. 하나의 `Verified` 배지로 출처 존재·의미·진실·승인을 합치지 않는다.
### Implementation references
확인일: 2026-10-16. 링크와 문서·공개 코드로 용도를 확인한 참고 자료다. 이 문서를 작성하면서 모든 데모를 실제 브라우저에서 재생하거나 성능 검증한 것은 아니다. 도구 채택을 강제하지 않는다.
| Reference | 사용할 부분 | 사용하지 않을 해석 |
|---|---|---|
| [Google DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | 디자인 의도·토큰·레이아웃·컴포넌트를 지속적인 문서로 전달 | 파일만 두면 모든 에이전트가 자동으로 읽는다는 가정 |
| [Ataraxia](https://ataraxia.ai.kr/?node=records) · [사용자 제공 캡처](references/ataraxia-reference.png) | 가는 연결선·노드 기반 공간, 사용자가 설명한 선택 후 내용 확인 경험 | 정지 캡처로 회전·클릭 동작이 검증됐다고 주장하거나 사이트 배치·브랜딩 복제 |
| [이전 IDEA 정적 시안](references/idea-visual-reference.png) | 밝은 화면·Google-inspired 색상·좌우 포털의 시각적 방향 | 시안 속 가상 논문·수치·인용·메뉴가 실제 제품 요구나 데이터라는 해석 |
| [Arena3Dweb 논문](https://academic.oup.com/nar/article/49/W1/W36/6246395) | 다층 그래프, 층별 회전·이동, 층간 연결 | 논문의 데이터 모델이나 화면 전체를 그대로 채택 |
| [3D Gyroscope Rings](https://codepen.io/Kavyant-Kumar/pen/YPGqWpa) | 링별 독립 회전과 정렬의 움직임 | 모든 링을 격렬하게 뒤집거나 읽기 중에도 계속 회전 |
| [3d-force-graph](https://github.com/vasturiano/3d-force-graph) · [focus](https://vasturiano.github.io/3d-force-graph/example/click-to-focus/) · [particles](https://vasturiano.github.io/3d-force-graph/example/emit-particles/) | 노드 포커스와 실제 이벤트에 연결할 관계 흐름 | 범용 중앙 구형 force graph를 최종 구도로 대체 |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) · [Raycaster](https://threejs.org/docs/pages/Raycaster.html) | 제한된 카메라 탐색과 노드 선택 | 특정 라이브러리/API를 제품 요구사항으로 고정 |
| [Bruno Simon — WebGL Black Hole](https://webgl-black-hole.vercel.app/) · [source](https://github.com/brunosimon/webgl-black-hole) | 포털의 링·코어·흡입 분위기 | 고비용 셰이더를 핵심 기능보다 먼저 구현 |
| [Career Hacker Alex — Second Brain (`/memory`)](https://www.careerhackeralex.com/memory) | 따뜻한 에디토리얼 오프화이트/아이보리 톤(`#F4F3EE` / `#F7F9FC` 조화), 차콜 잉크(`#141413` / `#202124`), 섬세한 `1px` 헤어라인 보더(`#E5E3DC` / `#DADCE0`), 알약형(`rounded-full`) 플로팅 프롬프트·필터, 대문자 트래킹 레이블(`0.12em`), 3계층 지식 구조(`Topics/Terms · Thoughts/Concepts · Theses/Claims`) 감성 | IDEA의 필수 좌우 포털(`Black Hole` → 3중 회전 궤도 → `White Hole`)과 Google 4색 시맨틱 구분을 제거하거나 단순 2D/단일 성좌 뷰로 축소 |
참고 구현의 코드를 복사할 때는 해당 라이선스와 표시 조건을 확인한다. 위 정적 시안의 화면 배치가 본문의 요구와 다르면 **이 문서의 좌우 구도·카드 비차폐·여러 회전 계층 조건이 우선**한다.
## Do's and Don'ts
| Do | Don't |
|---|---|
| 입력→의미 정렬→검토→승인된 출력의 좌우 공간을 처음부터 구현 | 포털을 나중에 붙일 장식으로 미루기 |
| 같은 세션의 기존 노드와 근거를 보존 | 입력마다 전체 우주를 새로 생성 |
| 같은 프롬프트로 질의와 URL 입력 처리 | 여러 Chat/Ingest/Wiki 화면을 먼저 만들기 |
| 카드에서 읽고 공간에서 관계 탐색 | 긴 문서를 회전하는 3D 면에 표시 |
| 근거 검사·모델 검토·사용자 승인을 따로 표시 | 애니메이션 완료를 검증 완료로 간주 |
| 실제 실행·검토 시점의 장면과 행동을 확인 | 스크린샷만으로 회전·클릭·승인을 통과 처리 |
