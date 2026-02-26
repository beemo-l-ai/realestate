# 수도권 부동산 실거래가 MCP 서버 (Oracle DB)

이 저장소는 아래를 제공합니다.

1. 국토부 실거래가(매매 및 전월세) 수집
2. Oracle DB 저장 및 월별 통계 자동 집계
3. 로컬 DB 브라우저 웹 환경 제공
4. ChatGPT를 위한 MCP 통계/조회 도구 (Raw SQL 지원)

## 아키텍처

```text
[국토부 실거래가 API (매매/전월세)]
        |
        v
 collectAndStore.ts / collectByDate.ts
        | (Transaction Parsing & Monthly Aggr.)
        v
[Oracle DB]
  - re_sale_transactions (매매 실거래 상세)
  - re_rent_transactions (전월세 임대 상세)
  - re_apartment_metadata (지역 메타)
  - re_apartment_areas (단지 평형)
  - re_sale_monthly_aggregates (매매 월별 건수 통계)
  - re_rent_monthly_aggregates (전월세 월별 건수 통계)
        |
        v
 MCP Server (src/server.js / src/mcp/server.ts)
  - search_listings (매물 샘플 UI용 - 최대 5건 반환)
  - query_realestate_db (통계 건수/결과 산출을 위한 Raw SQL 실행)
```

## 빠른 시작

### 1) 환경 변수

`.env.example`를 `.env`로 복사 후 입력합니다.

```bash
cp .env.example .env
```

필수:
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`
- `MOLIT_SERVICE_KEY`

선택:
- `MOLIT_RENT_API_BASE` (전월세 공공데이터 API)
- `MOLIT_API_BASE` (매매 공공데이터 API)
- `ORACLE_POOL_MIN`, `ORACLE_POOL_MAX`
- `WIDGET_DOMAIN` (Apps 제출 시 권장, 예: `https://your-widget-domain.example`)
- `KAKAO_MAP_APP_KEY` (카카오맵 JavaScript 키, `show_map` 기본 지도 렌더링용)

### 2) 설치/빌드

```bash
npm install
npm run check
npm run build
```

### 3) DB 스키마 초기화(테이블 + 인덱스)

```bash
npm run db:init
```

### 4) 로컬 DB 브라우저 실행 (DBeaver 대체)

`.env`의 Oracle 접속 정보를 그대로 사용해 웹 UI로 테이블/쿼리를 확인할 수 있습니다.

```bash
npm run db:browser
```

브라우저에서 `http://127.0.0.1:8787` 접속.

옵션 환경 변수:
- `DB_BROWSER_HOST` (기본: `127.0.0.1`)
- `DB_BROWSER_PORT` (기본: `8787`)
- `DB_BROWSER_DEFAULT_LIMIT` (기본: `100`)
- `DB_BROWSER_MAX_LIMIT` (기본: `500`)

안전 장치:
- `SELECT`/`WITH` 쿼리만 허용 (읽기 전용)
- 쿼리 결과 row 수 자동 제한

### 5) 데이터 수집/적재

단일 월:

```bash
npm run collect -- 202401
```

기간:

```bash
npm run collect -- 202401 202412
```

날짜 기반(권장):

```bash
npm run collect:date -- --mode bootstrap --from 2024-01-01 --to 2024-12-31
npm run collect:date -- --mode incremental --from 2025-01-01
```

### 6) MCP 서버 실행

```bash
npm run dev:mcp
```

Apps quickstart:

```bash
npm run dev:apps
```

## 인덱스 전략 요약

- 실거래 조회: `district_code + traded_at`, `region + traded_at`, `district_code + apartment_name + traded_at`
- 전월세 조회: `district_code + contracted_at`, `region + contracted_at`, `district_code + apartment_name + contracted_at`
- 월별 추이: `year_month + district_code`, `district_code + apartment_name + year_month`
- 메타데이터: `district_code + apartment_name`, `district_code + total_sale_trades`

## 도구 세부 정보

서버의 주 진입점은 `npm run dev:chatgpt` 스크립트를 통해 실행되는 `src/server.js` 이며, 아래 핵심 도구가 등록됩니다:

- `search_listings`: UI 연동을 위한 단순 '최근 실거래 샘플 조회기'. (절대 통계 산출 용도로 사용해서는 안 됩니다.)
- `query_realestate_db`: ChatGPT가 안전한 Raw SQL (SELECT 문)을 통해 `re_sale_monthly_aggregates` 등의 통계/개수 집계를 쿼리할 수 있도록 하는 강력한 도구.

(참고사항: `search_realestate_trends` 등은 레거시 `src/mcp/server.ts` 인터페이스에 정의되어 있습니다.)

## 🤖 개발 규칙 (AI Agent Development Rules)

AI 에이전트가 코딩 컨텍스트를 더 잘 파악할 수 있도록 다음 규칙을 엄격히 준수합니다.

1. **디렉토리별 컨텍스트 유지보수**: 파일 변경이나 추가 로직 변경이 발생할 경우, **해당 파일이 속한 디렉토리에 있는 마크다운(`.md`) 파일도 반드시 함께 수정**해야 합니다. 각 디렉토리의 `.md` 파일은 AI 에이전트에게 중요한 컨텍스트를 전달하는 용도로 관리됩니다.
2. **README 사전 확인**: 개발 및 변경 작업을 시작하기 전에는 **항상 프로젝트 루트의 `README.md` 파일을 한 번씩 확인**하여 전반적인 상태와 가이드를 숙지해야 합니다.
