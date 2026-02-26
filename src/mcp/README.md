# src/mcp

## 역할
- MCP 서버 생성 및 tool 등록
- GPT 질의와 Oracle 데이터 간 인터페이스 제공

## 핵심 파일
- `server.ts`: 툴 스키마, SQL 조회, 응답 포맷

## 입력/출력
- 입력: tool 인자(`zod`로 검증)
- 출력: `content` + `structuredContent`

## 이 디렉토리만 수정하면 되는 경우
- 툴 이름/설명/응답 문구 변경
- 새 MCP 툴 추가
- 텍스트 시각화 표현 변경

## 함께 확인할 가능성이 높은 파일
- `src/lib/types.ts` (구조화 응답 타입이 바뀌는 경우)
- `src/lib/store.ts` (조회 대상 테이블/쿼리 변경 시)
