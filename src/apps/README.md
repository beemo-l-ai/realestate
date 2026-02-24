# src/apps 디렉토리 안내

## 역할
- ChatGPT Apps SDK 연동을 위한 앱 템플릿/샘플 서버를 보관합니다.
- MCP 서버(`src/mcp`)와 별도로, Apps 전용 도구 메타데이터(`openai/outputTemplate`) 및 UI 리소스 예시를 관리합니다.

## 핵심 파일
- `quickstart/server.ts`: Apps SDK quickstart 스타일의 최소 골격 서버.

## 수정 원칙
- 실제 서비스 로직은 `src/lib`, `src/collector`에 두고 여기서는 ChatGPT Apps 연결 계층만 다룹니다.
- 컴포넌트 UI 템플릿 URI(`ui://...`) 변경 시 도구 `_meta.openai/outputTemplate`를 함께 수정합니다.
