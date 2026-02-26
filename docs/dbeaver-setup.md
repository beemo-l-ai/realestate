# DBeaver Community 로 Oracle DB 조회하기

## 1) DBeaver 실행

```bash
dbeaver
```

## 2) 새 연결 생성

1. `Database` > `New Database Connection`
2. `Oracle` 선택
3. 연결 방식은 `URL` 사용

JDBC URL 예시:

```text
jdbc:oracle:thin:@${ORACLE_CONNECT_STRING}?TNS_ADMIN=${ORACLE_WALLET_DIR}
```

예시(프로젝트 기본값):

```text
jdbc:oracle:thin:@realestate_high?TNS_ADMIN=/Users/leesungju/Documents/git/realestate/oracle-wallet
```

## 3) 인증 정보

- Username: `.env`의 `ORACLE_USER`
- Password: `.env`의 `ORACLE_PASSWORD`

## 4) 테스트 후 저장

- `Test Connection` 클릭
- 성공하면 `Finish`

## 5) 바로 확인할 SQL

```sql
SELECT COUNT(*) AS cnt FROM re_sale_transactions;
SELECT COUNT(*) AS cnt FROM re_apartment_metadata;

SELECT district_code, apartment_name, traded_at, price_krw
FROM re_sale_transactions
ORDER BY traded_at DESC
FETCH FIRST 20 ROWS ONLY;
```
