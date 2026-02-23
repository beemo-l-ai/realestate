# src/collector

## 역할
- 국토부 API 호출
- XML 파싱 및 정규화 레코드 생성

## 핵심 파일
- `molitCollector.ts`: 요청 파라미터 구성, XML 파싱, 거래 데이터 변환

## 입력/출력
- 입력: `districtCode`, `yearMonth`, `region`
- 출력: `TradeRecord[]`

## 이 디렉토리만 수정하면 되는 경우
- API endpoint/파라미터 변경
- XML 구조 변경 대응
- 거래 ID 생성 규칙 개선

## 함께 확인할 가능성이 높은 파일
- `src/lib/config.ts` (API 키/기본 URL)
- `src/lib/types.ts` (정규화 타입)
