# Apps SDK (ChatGPT Apps) 로컬 테스트 가이드

이 문서는 OpenAI Apps SDK quickstart 흐름에 맞춰 **로컬에서 MCP 서버를 띄우고**, ChatGPT에서 **(터널을 통해) 연결하여 테스트**하는 방법을 정리합니다.

## 0) 준비물

- Node.js 20+
- Firebase Firestore 프로젝트 + 서비스 계정
- (선택) 터널링 도구: `cloudflared` 또는 `ngrok`

## 1) 환경 변수 설정

```bash
cp .env.example .env
```

`.env`에 아래 값을 채웁니다.

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (개행 포함 → 문자열 내 `\n` 형태로 넣어도 됨)
- `MOLIT_SERVICE_KEY`

(선택)
- `PORT` (기본 8787)

## 2) 설치

```bash
npm install
npm run check
```

## 3) (선택) 데이터 수집해서 Firestore 채우기

```bash
# 예: 2024년 1월 한 달만
npm run collect -- 202401
```

## 4) Apps SDK quickstart 스타일 MCP HTTP 서버 실행

이 레포는 Apps SDK quickstart에 맞춰 **HTTP /mcp 엔드포인트**로 MCP를 제공합니다.

```bash
npm run dev:apps
# 또는
npm run build && npm run start:apps
```

기본 주소:
- `http://localhost:8787/mcp`

## 5) ChatGPT에서 로컬 서버 붙이기 (터널 필요)

ChatGPT가 로컬호스트(`localhost`)에 직접 접근할 수 없어서, 일반적으로 **터널링**이 필요합니다.

### 옵션 A) cloudflared

```bash
cloudflared tunnel --url http://localhost:8787
```

출력되는 `https://....trycloudflare.com` 주소를 복사한 뒤, ChatGPT Apps 설정에서 MCP 서버 URL을:

- `https://<생성된-도메인>/mcp`

로 등록합니다.

### 옵션 B) ngrok

```bash
ngrok http 8787
```

표시되는 `https://<subdomain>.ngrok-free.app` 를 사용해:

- `https://<subdomain>.ngrok-free.app/mcp`

로 등록합니다.

## 6) 기대 동작

- 앱 UI 리소스: `ui://realestate/trend-widget.html`
- 도구: `get_capital_region_monthly_trends`

ChatGPT에서 도구 호출 시, Firestore의 `apt_monthly_aggregates`에서 조회한 결과를 반환하고,
UI 위젯이 `structuredContent.rows`를 표로 렌더링합니다.
