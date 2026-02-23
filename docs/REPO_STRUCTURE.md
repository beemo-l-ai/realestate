# Repository Structure Guide

이 문서는 **대규모 업데이트를 대비한 탐색/수정 단위**를 정의합니다.
목표는 기능 변경 시 전체 코드를 읽지 않고도, 필요한 디렉토리/파일만 빠르게 판단하는 것입니다.

## 1. 디렉토리 책임 경계

| 경로 | 역할 | 주로 수정할 파일 |
|---|---|---|
| `src/mcp` | MCP 툴 정의, 질의 응답 포맷 | `server.ts` |
| `src/collector` | 외부 API 호출/정규화 수집 | `molitCollector.ts` |
| `src/lib` | 공통 타입/설정/저장소 접근 | `types.ts`, `config.ts`, `store.ts`, `firebase.ts` |
| `src/scripts` | 배치/운영용 실행 스크립트 | `collectAndStore.ts` |
| `docs` | 구조/규칙/운영 문서 | 각 문서 파일 |

## 2. 변경 유형별 우선 탐색 경로

### A) MCP 응답 포맷 변경 / 새 질의 도구 추가
1. `src/mcp/README.md`
2. `src/mcp/server.ts`
3. 필요 시 `src/lib/types.ts`

### B) 수집 소스 변경 (MOLIT 파라미터, 파싱 규칙)
1. `src/collector/README.md`
2. `src/collector/molitCollector.ts`
3. 필요 시 `src/lib/types.ts`

### C) Firestore 저장 스키마 변경
1. `src/lib/README.md`
2. `src/lib/store.ts`
3. `src/lib/types.ts`
4. 필요 시 `README.md`의 스키마 섹션

### D) 배치 동작 변경 (기간 계산/대상 지역/실행 흐름)
1. `src/scripts/README.md`
2. `src/scripts/collectAndStore.ts`
3. 필요 시 `src/lib/config.ts`

## 3. 작업 규율 (검색 범위 최소화)

- 원칙적으로 `rg <키워드> src/<target-dir>` 형태로 **타겟 디렉토리만 검색**합니다.
- 수정 파일은 기능 책임 경계에 맞는 최소 파일로 제한합니다.
- 경계가 모호하면 먼저 각 디렉토리 README를 확인하고, 그 뒤 필요한 파일만 엽니다.

## 4. 문서 동기화 원칙

다음 중 하나가 바뀌면 문서도 함께 업데이트합니다.
- 입력/출력 스키마
- 환경 변수
- 컬렉션 구조
- 실행 커맨드
- 디렉토리 책임 범위
