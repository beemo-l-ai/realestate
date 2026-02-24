# PR #2 머지 충돌 해결 가이드

이 문서는 `Define scalable directory-based workflow and coding rules` + `Apps SDK quickstart` 변경이
동시에 들어올 때 자주 발생하는 충돌 파일과 우선 해소 순서를 정의합니다.

## 충돌 우선순위

1. `src/apps/**` 신규 파일은 **항상 유지**합니다.
2. `src/mcp/**`, `src/lib/**`는 런타임 코드가 우선이며, README 문구는 이후 정리합니다.
3. `README.md`, `docs/**`는 기능 동작을 깨지 않도록 마지막에 합칩니다.

## 권장 병합 절차

```bash
git checkout work
git fetch origin
git merge origin/main
```

충돌 발생 시 아래 순서로 처리합니다.

### 1) 기능 코드 우선 반영

```bash
git checkout --theirs src/apps/quickstart/server.ts
# 필요 시 아래도 최신 기능 기준으로 선택
# git checkout --theirs src/mcp/server.ts src/lib/store.ts
```

### 2) 문서는 union 원칙으로 결합

`.gitattributes`에서 `*.md merge=union`으로 설정되어 있어, 대부분 자동 결합됩니다.
자동 결합 후 중복 문구만 수동 정리합니다.

### 3) 검증

```bash
rg -n "<<<<<<<|=======|>>>>>>>" .
npm run check
```

## 이번 정리에서 확정한 기준

- Apps SDK 골격 파일: `src/apps/quickstart/server.ts`
- Apps 디렉토리 문서: `src/apps/README.md`
- 실행 스크립트: `package.json`의 `dev:apps`, `start:apps`


## 자동 해소 스크립트

충돌 상태에서 아래 명령으로 PR #2 중복 충돌 파일을 자동 해소할 수 있습니다.

```bash
npm run resolve:main-conflicts
```

> 스크립트는 알려진 중복 파일에서 `--theirs`를 우선 적용하고, 미해결 파일이 남으면 실패합니다.
