# MCP Test Cases

## Test Case 1
- Scenario: 지원 지역 코드 목록 조회가 정상 동작하는지 확인
- User prompt: `지원 지역 목록을 보여줘`
- Tool triggered: `get_districts`
- Expected output: 강남구/분당구 등 지원 지역명과 5자리 코드가 텍스트 목록으로 반환됨. 쓰기/수정 없이 조회만 수행됨.

## Test Case 2
- Scenario: 특정 구 + 키워드로 아파트 메타데이터 검색
- User prompt: `강남구에서 래미안이 포함된 아파트 메타데이터를 찾아줘`
- Tool triggered: `search_apartment_metadata`
- Expected output: 조건에 맞는 아파트들의 법정동, 단지명, 평형 목록, 누적거래 건수가 반환됨. 결과가 없으면 데이터 없음 메시지가 반환됨.

## Test Case 3
- Scenario: 월별 실거래가 추이 조회 (기간 필수 필드 포함)
- User prompt: `분당구 아파트의 202401부터 202412까지 월별 평균 실거래가 추이를 보여줘`
- Tool triggered: `search_realestate_trends`
- Expected output: 월별 요약(평균가/거래건수)과 텍스트 차트가 반환됨. 데이터가 없으면 조건 불일치 안내 문구가 반환됨.

## Test Case 4
- Scenario: 최신 매매 거래 사례 조회
- User prompt: `서울 강남구 대치동에서 최근 매매 실거래 사례 5건 보여줘`
- Tool triggered: `get_latest_transaction_examples`
- Expected output: 거래일, 지역/법정동, 아파트명, 면적, 층, 가격이 포함된 최근 매매 사례가 최대 5건 반환됨. 없으면 거래 사례 없음 메시지 반환.

## Test Case 5
- Scenario: 최신 전월세 거래 사례 조회 (전세 필터)
- User prompt: `송파구 잠실동 최근 전세 거래 사례 5건 보여줘`
- Tool triggered: `get_latest_rent_examples`
- Expected output: 계약일, 지역/법정동, 아파트명, 면적, 층, 임대유형, 보증금/월세가 포함된 사례가 반환됨. 없으면 전월세 거래 사례 없음 메시지 반환.
