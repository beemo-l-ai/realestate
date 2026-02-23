# Real Estate Apps SDK 최소 템플릿

OpenAI Apps SDK quickstart 흐름을 참고한 **최소 골격**입니다.

## 포함 내용
- MCP 서버 (`/mcp`) + 헬스체크 (`/health`)
- 샘플 툴 `search_listings`
- 샘플 UI 리소스 `ui://widget/listings.html`

## 실행
```bash
npm install
npm run dev
```

기본 포트는 `3000`이며, 엔드포인트는 다음과 같습니다.
- MCP: `http://localhost:3000/mcp`
- Health: `http://localhost:3000/health`

## Apps 등록 시 체크리스트
1. 공개 URL로 배포 후 `/mcp`를 외부에서 접근 가능하게 구성
2. 인증(OAuth/API key) 정책 추가
3. 실제 DB/검색 API 연동으로 `search_listings` 구현 교체
4. `openai/outputTemplate`에 연결된 위젯 HTML 보안 점검

## 참고
- 현재 코드는 **샘플 데이터 기반 템플릿**입니다.
- Apps SDK 문서 버전에 따라 transport/메타 키가 변경될 수 있어 최신 문서와 함께 검증하세요.
