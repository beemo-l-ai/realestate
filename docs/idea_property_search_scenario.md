# 부동산 정보 제공 ChatGPT App 기획 및 API 검토 문서

## 1. 개요
본 문서는 ChatGPT Apps에 등록되어 사용자가 자연어로 부동산 정보를 쉽게 검색하고, 시각적인 위젯을 통해 직관적인 매물 및 시세 정보를 제공받을 수 있도록 하는 서비스의 시나리오 및 API 구현 방안을 정리한 문서입니다.

## 2. 핵심 제공 가치
1. **부동산 통계 정보 제공**: 지역 및 단지의 시세 추이, 거래량 통계.
2. **손쉬운 매물 찾기**: 복합적인 사용자 조건(지역, 가격, 면적 등)에 맞는 실거래/매물 탐색.
3. **사용자 경험 극대화(위젯)**: 지도 + 리스트 형태의 UI를 통해 한눈에 파악 가능한 결과 제공.

---

## 3. 핵심 시나리오: "손쉬운 매물 찾기" 및 "위젯 제공"

### 3.1 사용자 프롬프트 예시
> *"분당 오리역 근처에 9억 이하로 20평 이상 매매 물건 찾아줘"*

### 3.2 시나리오 Flow (LLM ↔ MCP API ↔ 사용자)
1. **의도 및 조건 추출 (LLM 내부 로직)**
   - 위치: "분당 오리역 근처" → LLM이 지식 기반으로 `지역: 성남시 분당구`, `법정동: 구미동`으로 매핑.
   - 예산: "9억 이하" → `maxPrice: 900,000,000` (원 단위 또는 억 단위 정규화).
   - 면적: "20평 이상" → 전용면적 약 `minAreaM2: 59` (또는 66) 이상으로 변환.
   - 거래 유형: "매매" → `tradeType: SALE`.

2. **조건 기반 검색 API 호출 (MCP API)**
   - LLM이 추출한 파라미터를 바탕으로 우리 서비스의 매물/실거래 검색 API를 호출합니다.
   - API는 데이터베이스를 조회하여 해당 조건에 맞는 최근 실거래 내역이나 매물 후보군을 필터링하여 반환합니다.

3. **결과 가공 및 위젯 반환 (MCP API → LLM → 사용자)**
   - API 응답에는 단순 텍스트뿐만 아니라, **지도와 리스트가 결합된 웹 위젯 URL**이 포함됩니다.
   - LLM은 사용자에게 요약된 텍스트 답변과 함께 위젯 링크(또는 임베드/미리보기)를 제공합니다.
   - **출력 예시**: "분당구 구미동 일대에서 9억 이하, 전용 59㎡ 이상의 매매 실거래 사례 5건을 찾았습니다. 상세 위치와 아파트 정보는 아래 위젯에서 확인해보세요! [지도에서 매물 보기](https://our-service.com/widget/map?...)"

---

## 4. MCP API 현황 및 개선 방안

현재 `src/mcp/server.ts`에 구현된 API를 바탕으로, 시나리오 달성을 위해 **유지/변경/삭제할 API**를 검토합니다.

### 4.1 기존 API 분석 및 정리 대상
* **`get_districts`**: 지역명 매핑을 위해 LLM이 참고할 수 있으나, LLM의 자체 지식이 뛰어날 경우 필수적이지 않을 수 있습니다. (유지하되 내부 참고용으로 사용)
* **`search_apartment_metadata`**: 아파트 단지명 기반의 상세 조회를 위해 유효합니다. (유지)
* **`search_realestate_trends`**: 핵심 가치인 '통계 정보 확인'을 위해 필수적입니다. (유지)
* ⚠️ **`get_latest_transaction_examples` 및 `get_latest_rent_examples` (통합 및 고도화 필요)**
  - **문제점**: 현재 면적(`areaM2`)의 정확한 일치만 지원하고, **가격 범위(이상/이하)** 필터링 기능이 없습니다. "9억 이하", "20평 이상"과 같은 복합 쿼리에 대응할 수 없습니다.

### 4.2 신규/고도화 API 제안: `search_properties` (매물 및 실거래 복합 검색)

위 두 가지 사례 조회 API를 하나로 통합하거나 기능을 대폭 확장하여, **복합 필터링 및 위젯 URL 생성** 기능을 담당하는 API로 개편해야 합니다.

**[입력 파라미터 (Input Schema)]**
```typescript
{
  tradeType: z.enum(["SALE", "JEONSE", "WOLSE"]).describe("매매, 전세, 월세"),
  region: z.string().optional(),
  districtName: z.string().optional().describe("구 단위 지명 (예: 분당구)"),
  legalDong: z.string().optional().describe("법정동 이름 (예: 구미동) - 지하철역 등의 위치를 LLM이 법정동으로 변환하여 입력"),
  minPriceEok: z.number().optional().describe("최소 매매가/보증금 (단위: 억)"),
  maxPriceEok: z.number().optional().describe("최대 매매가/보증금 (단위: 억)"),
  minAreaM2: z.number().optional().describe("최소 전용면적 (㎡)"),
  maxAreaM2: z.number().optional().describe("최대 전용면적 (㎡)"),
  limit: z.number().default(10)
}
```

**[출력 데이터 (Output)]**
1. **요약 텍스트**: LLM이 사용자에게 자연스럽게 말해줄 수 있는 결과 요약 데이터 (예: "총 X건의 거래가 있습니다. 평균 가격은 Y억입니다.")
2. **상세 리스트 (JSON)**: 매물/실거래 상세 내역 배열.
3. 🌟 **위젯 URL (`widgetUrl`)**:
   - 검색된 파라미터(또는 검색 결과의 ID 리스트)를 Query String으로 포함한 프론트엔드 URL.
   - 예: `https://[서비스도메인]/embed-map.html?dong=구미동&type=SALE&maxPrice=9&minArea=59`
   - 이 URL을 통해 사용자는 브라우저 혹은 인앱 웹뷰에서 **지도 기반 매물 확인**이 가능해집니다.

---

## 5. 위젯 구현 방안 검토 (사용자 경험 극대화)

ChatGPT App(또는 Custom GPTs) 환경에서는 직접적인 지도(HTML/JS) 렌더링이 불가능합니다. 따라서 **웹 링크 기반의 리치 미디어(Rich Preview) 형태** 또는 **iFrame 지원 환경에서의 임베드** 방식을 사용해야 합니다.

1. **위젯 전용 웹 페이지 구축 (`public/embed-map.html` 등 활용)**
   - 모바일 환경에 최적화된 반응형 웹앱으로 구현.
   - URL 파라미터로 검색 조건을 받아, 해당 조건의 데이터를 화면 진입 시 API로 다시 불러와 지도(카카오/네이버 맵)에 마커로 표시.
   - 하단에는 카드 리스트 형태로 매물 목록을 배치.
2. **LLM의 위젯 제시 방식**
   - API 응답에 `[지도 위젯 열기](URL)` 형태의 마크다운 링크를 포함하여 LLM이 출력하도록 유도합니다.
   - Open Graph (OG) 태그를 위젯 페이지에 동적으로 생성해주면, ChatGPT UI에서 링크가 깔끔한 카드(미리보기 이미지 포함) 형태로 렌더링될 수 있어 UX가 극대화됩니다.

## 6. 결론 및 Action Item
1. **API 개편**: 기존 `get_latest_transaction_examples`, `get_latest_rent_examples`를 삭제(또는 내부용으로 격하)하고, 다중 필터(가격, 면적 범위)를 지원하는 `search_properties` API로 통합 개발.
2. **LLM 프롬프팅 최적화**: 사용자의 일상어(지하철역, 예산, 평수)를 `legalDong`, `minAreaM2`, `maxPriceEok` 등의 표준 파라미터로 매핑하도록 MCP Tool Description(Input Schema)을 구체적으로 작성.
3. **위젯 URL 제공 로직**: `search_properties` API 결과 반환 시, 검색 조건을 반영한 프론트엔드 위젯 URL을 조합하여 함께 리턴.

---

## 7. 시나리오 검토 결과 (2026-02-27 기준)

아래 내용은 현재 프로젝트의 최종 목적(ChatGPT Apps 등록)과 실제 확보 데이터(Oracle 실측) 기준으로, 기존 시나리오를 현실 적용 가능하게 보정한 결과입니다.

### 7.1 프로젝트 목적 정합성 점검

1. 최종 서비스 기준은 `src/server.js`의 **Apps MCP 도구 흐름**입니다.
2. 따라서 실제 운영 시나리오는 `search_apartment_candidates(옵션널)` → `select_apartment_candidate(옵션널)` → `query_realestate_db` → `get_location_ui` 중심으로 잡는 것이 현재 코드와 일치합니다.
3. 문서의 `search_properties`는 유효한 목표이지만, **즉시 운영 기준**에서는 "중장기 통합 API"로 분리해 다루는 것이 현실적입니다.

### 7.2 확보 데이터 현황 (실측)

| 항목 | 값 |
|---|---|
| 매매 실거래 건수 (`re_sale_transactions`) | 64,242건 |
| 전월세 실거래 건수 (`re_rent_transactions`) | 199,694건 |
| 아파트 메타 (`re_apartment_metadata`) | 2,878건 |
| 매매 월별 집계 (`re_sale_monthly_aggregates`) | 22,245건 |
| 전월세 월별 집계 (`re_rent_monthly_aggregates`) | 51,775건 |
| 최근 면적별 통계 (`re_recent_area_stats`) | 5,109건 |
| 매매 데이터 범위 | 2024-01-01 ~ 2025-12-31 |
| 전월세 데이터 범위 | 2024-01-01 ~ 2025-12-31 |
| `re_recent_area_stats` 업데이트 시점 | 2026-02-26 (UTC) |

현재 거래 데이터의 시군구 코드는 아래 8개로 확인됩니다.

- `11110` 종로구
- `11680` 강남구
- `11710` 송파구
- `41135` 성남시 분당구
- `41281` 고양시 덕양구
- `41465` 용인시 수지구
- `28177` 인천 미추홀구
- `28237` 인천 부평구

즉, "수도권 전체 커버리지"로 답변하기보다는 **현재 수집 대상 8개 시군구 중심 서비스**로 명시하는 것이 정확합니다.

### 7.3 현실 제약 요약

1. 현재 DB는 **실거래 데이터** 중심이며, 민간 플랫폼의 실시간 매물(리스팅) DB가 아닙니다.
2. 거래 테이블에 좌표(lat/lng)가 없어, "역에서 반경 N미터"를 SQL에서 직접 필터링하기 어렵습니다.
3. 단지명 변형(띄어쓰기/별칭)이 많아 후보 선택 단계를 생략하면 오조회 위험이 큽니다.
4. `query_realestate_db`는 안전상 `SELECT`만 허용하며, 결과 행도 최대 100건으로 제한됩니다.

---

## 8. 현실 가능한 개선 시나리오 (현행 도구 기준)

### 8.1 사용자 프롬프트(운영 권장 형태)

> *"분당구에서 2025년 기준 9억 이하, 전용 59㎡ 이상 매매 실거래 사례 보여주고 지도도 같이 보여줘."*

기존의 "매물 찾아줘" 표현은 오해를 줄이기 위해 답변에서 **"실거래 사례 기준"**임을 명시합니다.

### 8.2 실행 Flow (LLM ↔ Apps MCP API ↔ 사용자)

1. **질의 분류 및 지원 범위 확인**
   - 질의가 통계/시세/사례 조회면 `query_realestate_db` 경로로 진행.
   - 지원 외 지역이면 현재 지원 지역(8개 시군구)으로 범위를 재확인.

2. **단지명 불명확 시 후보군 먼저 확정**
   - `search_apartment_candidates` 호출로 후보 리스트 생성.
   - 복수 후보일 경우 사용자 선택(또는 UI 선택 이벤트 `select_apartment_candidate`)으로 단지 확정.

3. **조건 SQL 조회 (핵심)**
   - `query_realestate_db`에서 거래유형/기간/가격/면적 조건을 SQL로 직접 적용.
   - 예시(매매):

```sql
SELECT
  TO_CHAR(traded_at, 'YYYY-MM-DD') AS traded_at,
  legal_dong,
  apartment_name,
  area_m2,
  floor,
  price_krw
FROM re_sale_transactions
WHERE district_code = '41135'
  AND traded_at BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
  AND price_krw <= 900000000
  AND area_m2 >= 59
ORDER BY traded_at DESC
FETCH FIRST 20 ROWS ONLY
```

4. **결과 요약 + 기준일 고지**
   - 건수, 가격 구간, 대표 사례를 요약.
   - "현재 DB 최신 실거래 기준일: 2025-12-31"을 함께 안내.

5. **지도 위젯 제공**
   - 조회 결과의 주소/단지명을 `get_location_ui`의 `addresses`로 전달.
   - `searchPattern`(매매/전세/월세, 면적)을 함께 넘겨 지도 인포윈도우의 보조 통계를 강화.

6. **최종 응답 포맷**
   - 텍스트 요약(핵심 수치) + 위젯(위치/비교 확인) 조합으로 마무리.

---

## 9. 실행 우선순위 재정의 (현실 적용 기준)

### 9.1 즉시 적용 (현행 코드로 가능)

1. 운영 프롬프트 규칙에 `후보 단지 확정 → SQL 조회` 순서를 강제.
2. 자주 쓰는 SQL 템플릿(가격 상한/면적 하한/기간 조건)을 표준화.
3. 답변 문구를 "실시간 매물"이 아닌 "실거래 사례 기반 추천"으로 통일.
4. `aggregateRecentStats` 배치를 주기 실행해 지도 보조 통계 최신성 유지.

### 9.2 다음 단계 (중장기)

1. `search_properties` 통합 API 도입(가격/면적 범위 필터를 스키마에서 직접 지원).
2. `widgetUrl` 직접 반환형 응답으로 LLM의 호출 부담 축소.
3. 역세권/POI 기반 필터를 위한 좌표/거리 계산 도구(`search_poi_distance`)를 정식 운영 경로에 편입.
