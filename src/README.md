# src Directory Guide

(업데이트) - ChatGPT MCP 연동시 '가장 비싼 월세' 조회나 지역 문의 시 \`show_map\` 툴을 호출하여 텍스트 데이터와 지도를 함께 보여주는 기능(Map 강화)이 적용되어 있습니다.
(업데이트) - 아파트 후보 검색(`search_apartment_candidates`)은 UI 후보 버튼 선택을 지원하며, 선택값은 \`select_apartment_candidate\` 툴로 다시 전달되어 후속 SQL 조회에 활용됩니다.
(업데이트) - `search_properties`는 조회 전용, `get_location_ui`는 지도 렌더링 전용으로 분리 운영되며, `query_realestate_db`는 통계/집계 목적에서만 사용됩니다.

`src`는 아래 5개 책임 단위로 분리되어 있습니다.

- `apps`: ChatGPT Apps SDK 템플릿/연동 계층
- `mcp`: GPT가 호출하는 MCP tool 진입점
- `collector`: 외부 데이터 소스 수집/정규화
- `lib`: 공통 타입, 환경설정, 저장 로직
- `scripts`: 운영/배치 실행 엔트리

## 변경 포인트(Quick Notes)

- `src/server.js`는 `search_properties` 결과를 `addressesForMap` + `widgetUrl`까지 생성해 `get_location_ui` 또는 링크 응답에 전달합니다.
- `query_realestate_db`는 `reason` 필드와 단순 목록형 SQL 차단 규칙이 있어, 거래 상세 단건 목록 조회는 `search_properties` 경로로 유도됩니다.
- `search_properties`는 문서 기준 필드(`districtName`, `region`, `legalDong`, `min/maxPriceEok`)를 함께 지원해 LLM 규격 매핑이 쉬워집니다.

## 빠른 작업 방법

1. 먼저 변경하려는 기능에 맞는 하위 디렉토리 README를 확인합니다.
2. 해당 디렉토리 파일만 우선 검색/수정합니다.
3. 경계가 넘어갈 때만 `lib` 또는 인접 디렉토리로 확장합니다.

관련 문서:
- `docs/REPO_STRUCTURE.md`
- `docs/DEVELOPMENT_RULES.md`
