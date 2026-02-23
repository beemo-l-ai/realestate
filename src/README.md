# src Directory Guide

`src`는 아래 5개 책임 단위로 분리되어 있습니다.

- `apps`: ChatGPT Apps SDK 템플릿/연동 계층
- `mcp`: GPT가 호출하는 MCP tool 진입점
- `collector`: 외부 데이터 소스 수집/정규화
- `lib`: 공통 타입, 환경설정, 저장 로직
- `scripts`: 운영/배치 실행 엔트리

## 빠른 작업 방법

1. 먼저 변경하려는 기능에 맞는 하위 디렉토리 README를 확인합니다.
2. 해당 디렉토리 파일만 우선 검색/수정합니다.
3. 경계가 넘어갈 때만 `lib` 또는 인접 디렉토리로 확장합니다.

관련 문서:
- `docs/REPO_STRUCTURE.md`
- `docs/DEVELOPMENT_RULES.md`
