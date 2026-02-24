# src/scripts

## 역할
- 운영/배치 실행용 엔트리 포인트 제공

## 핵심 파일
- `collectAndStore.ts`: 월 범위 계산, 지역 반복 수집, 저장 실행
- `collectByDate.ts`: 날짜(`YYYY-MM-DD`) 기반 수집(초기 전체/증분 크론 대응)

## 입력/출력
- 입력: CLI
  - `collectAndStore.ts`: `startYm`, `endYm`
  - `collectByDate.ts`: `--mode`, `--from`, `--to?`
- 출력: 콘솔 운영 로그 + Firestore upsert

## 이 디렉토리만 수정하면 되는 경우
- 배치 수행 순서 변경
- 로그 형식 개선
- 인자 처리/기본값 변경

## 함께 확인할 가능성이 높은 파일
- `src/collector/molitCollector.ts`
- `src/lib/store.ts`
- `src/lib/config.ts`


## 추가 스크립트
- `resolveMainConflicts.ts`: `main` 병합 시 알려진 충돌 파일을 자동으로 정리하는 보조 도구
