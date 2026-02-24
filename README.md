# 수도권 부동산 실거래가 MCP 서버 (ChatGPT Apps 연동 준비)

이 저장소는 **ChatGPT Apps(https://chatgpt.com/apps)에서 사용할 수 있는 형태**를 목표로,
아래 3가지를 한 번에 제공합니다.

1. 데이터 수집: 국토부 실거래가(아파트) API 수집
2. 데이터 저장: Firebase Firestore 적재 + 월별 집계
3. MCP 서버: GPT가 질의할 수 있는 도구(`search_realestate_trends`, `get_latest_transaction_examples`) 제공
4. Apps SDK 템플릿: ChatGPT Apps quickstart 스타일의 최소 서버 골격 제공

> 범위: 한국 부동산 중 **수도권(서울/경기/인천)**

---

## 1) ChatGPT Apps 관점에서의 구현 검토

실무적으로는 UI부터 만들기보다, ChatGPT가 신뢰 가능한 데이터를 조회하도록 **MCP 서버를 먼저 구축**하는 방식이 빠르고 안정적입니다.

- ChatGPT가 자연어 질의 수신
- MCP tool 호출
- Firestore 그룹 집계/거래 데이터 조회
- 결과를 텍스트/구조화 데이터로 반환

즉, 이 저장소는 ChatGPT Apps에서 확장 가능한 **백엔드(툴 서버) 코어**입니다.

---

## 2) 아키텍처

```text
[국토부 실거래가 API]
        |
        v
 collectAndStore.ts (월별/지역별 수집)
        |
        v
[Firestore]
  - apt_transaction_groups
  - apt_monthly_aggregate_groups
        |
        v
 MCP Server (src/mcp/server.ts)
  - search_realestate_trends
  - get_latest_transaction_examples
        |
        v
 ChatGPT Apps / GPT Tool Calling
```

---

## 3) 대규모 업데이트 대응 구조

기능 수정 시 전체 파일을 읽지 않고, 관련 디렉토리만 보고 판단할 수 있도록 구조 문서를 추가했습니다.

- 레포 구조/탐색 순서: `docs/REPO_STRUCTURE.md`
- 코드/개발 규칙: `docs/DEVELOPMENT_RULES.md`
- 디렉토리별 요약:
  - `src/README.md`
  - `src/apps/README.md`
  - `src/mcp/README.md`
  - `src/collector/README.md`
  - `src/lib/README.md`
  - `src/scripts/README.md`

신규 디렉토리를 만들 때도 동일하게 README를 추가해 탐색 비용을 낮추는 것을 기본 규칙으로 합니다.

---

## 4) 빠른 시작

### 4.1 환경 변수

`.env.example`를 `.env`로 복사한 뒤 값을 채웁니다.

```bash
cp .env.example .env
```

필수:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `MOLIT_SERVICE_KEY`
- `MOLIT_API_BASE` (선택, 기본값: `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`)

`MOLIT_SERVICE_KEY`는 **일반 인증키(Decoding)** 값을 권장합니다.
만약 공공데이터포털의 Encoding 키를 넣어도 실행 시 1회 decode 후 요청하도록 처리되어 있습니다.

### 4.2 설치/빌드

```bash
npm install
npm run check
npm run build
```

### 4.3 데이터 수집/적재

단일 월:

```bash
npm run collect -- 202401
```

기간:

```bash
npm run collect -- 202401 202412
```


날짜 기반(권장, 크론잡 용도):

```bash
# 초기 1회 전체 수집 (예: 2024년 전체)
npm run collect:date -- --mode bootstrap --from 2024-01-01 --to 2024-12-31

# 증분 수집 (월 1회 크론: 해당 월만)
npm run collect:date -- --mode incremental --from 2025-01-01
```

### 4.4 MCP 서버 실행

```bash
npm run start:mcp
```

(개발 모드)

```bash
npm run dev:mcp
```


### 4.5 Apps SDK 최소 템플릿 실행 (로컬 테스트)

```bash
npm run dev:apps
```

- 파일: `src/apps/quickstart/server.ts`
- 로컬 MCP 엔드포인트: `http://localhost:8787/mcp` (PORT로 변경 가능)
- 포함 내용: Apps SDK quickstart 스타일 리소스/도구 등록, 위젯 HTML 리소스(`ui://...`), 수도권 월별 추이 조회 도구

자세한 로컬 테스트(터널 포함) 방법은 아래 문서 참고:
- `docs/APPS_SDK_LOCAL_TEST.md`


### 4.6 GitHub Actions로 수집 테스트

수동 실행 워크플로우: `.github/workflows/test-data-collection.yml`

1) 저장소 **Settings → Secrets and variables → Actions**에 아래 시크릿을 추가
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `MOLIT_SERVICE_KEY`

> 참고: **Codespaces secrets와 Actions secrets는 별개**입니다. Actions에서 실행하려면 반드시 Actions 시크릿에 동일 키를 등록해야 합니다.

2) GitHub 탭에서 **Actions → Test Data Collection → Run workflow** 실행
- `mode`: `incremental` 또는 `bootstrap`
- `from`: `YYYY-MM-DD`
- `to`: bootstrap일 때만 입력

---

## 5) Firestore 스키마

### apt_transaction_groups
- `id`: 그룹 문서 ID (`region|districtCode|yearMonth|legalDong|apartmentName`)
- `region`: 서울/경기/인천
- `districtCode`: 법정동 코드
- `yearMonth`: YYYYMM
- `groupKey`: `legalDong|apartmentName`
- `legalDong`: 법정동
- `apartmentName`: 아파트명
- `trades`: 동일 단지/주소 그룹의 거래 배열
- `txCount`: 그룹 거래 건수
- `lastTradedAt`: 그룹 내 최신 거래일

### apt_monthly_aggregate_groups
- `id`: 그룹 문서 ID (`region|districtCode|yearMonth`)
- `region`
- `districtCode`
- `yearMonth`: YYYYMM
- `items`: 단지별 월 집계 배열 (`apartmentName`, `avgPriceKrw`, `txCount` 등 포함)
- `totalTxCount`: 문서 전체 거래 건수

---

## 6) MCP 도구 명세

### `search_realestate_trends`
입력:
- `region?`: 서울 | 경기 | 인천
- `districtCode?`
- `apartmentName?`
- `fromYm`: YYYYMM
- `toYm`: YYYYMM

출력:
- 월별 평균가 요약
- 텍스트 기반 시각화(막대)
- `structuredContent`에 원본 집계 결과 포함

### `get_latest_transaction_examples`
입력:
- `region?`
- `districtCode?`
- `apartmentName?`
- `limit` (1~30, 기본 10)

출력:
- 최신 거래 사례 목록
- `structuredContent.rows`

---

## 7) ChatGPT Apps 연동 팁

실제 배포 시에는 MCP 서버를 네트워크에서 접근 가능한 형태(예: Cloud Run)로 띄우고,
ChatGPT Apps 설정에서 해당 서버를 툴 공급자로 연결합니다.

권장 추가 작업:
- Firestore composite index 사전 생성
- 지역명/법정동명 alias 사전 추가(질의 정확도 향상)
- 월별 집계 외 평당가, 면적 구간별 지표 추가
- RAG용 설명 문서(세금/대출 규정) 컬렉션 분리

---

## 8) 주의사항

- 국토부 API는 호출량/응답 포맷 제약이 있으므로 배치 수집을 권장합니다.
- MCP 응답은 사실 기반 데이터만 반환하도록 강제하고, 예측성 문구는 명시적으로 분리하세요.
