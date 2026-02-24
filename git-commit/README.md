# git-commit plugin

Claude Code용 변경 추적 + `/commit` 자동화 플러그인입니다.

## 동작

1. `UserPromptSubmit` 훅에서 사용자 intent를 `.codex-changes/changes.jsonl`에 기록
2. `PostToolUse` 훅에서 Edit/Write/MultiEdit 도구의 변경 파일 경로 기록
3. `/commit` 실행 시 로그 + 현재 git 변경사항을 합쳐 Conventional Commit 메시지 생성
4. 로그에 있는 파일만 `git add -- <file...>`로 staging (`git add .` 미사용)
5. 커밋 후 `gh` CLI가 있으면 PR 생성 시도
6. 커밋 성공 시 `.codex-changes/changes.jsonl` 비움

## 파일 구조

- `scripts/change-log.mjs`: JSONL 로깅 유틸
- `scripts/hook-user-prompt-submit.mjs`: 사용자 요청 기록 훅
- `scripts/hook-post-tool-use.mjs`: 파일 변경 기록 훅
- `scripts/commit-from-log.mjs`: 커밋/PR 자동화 스크립트
- `examples/claude-settings.json`: 훅 등록 예시
- `commands/commit.md`: `/commit` 커맨드 예시

## 설치

1. Claude Code 설정에 `examples/claude-settings.json` 내용을 반영
2. `/commit` 명령에서 아래를 실행하도록 연결

```bash
node git-commit/scripts/commit-from-log.mjs
```

## Codex CLI 연결

Codex CLI는 현재 `UserPromptSubmit`/`PostToolUse` 훅 키를 직접 제공하지 않아,
프로젝트 로컬 `notify` 훅으로 연결합니다.

- 설정 파일: `.codex/config.toml`
- notify 스크립트: `git-commit/scripts/hook-notify.mjs`
- 기능 플래그: `features.codex_git_commit = true`

notify 훅은 턴 종료 시점 payload + `git status --porcelain`를 기반으로
intent/변경 파일 로그를 `.codex-changes/changes.jsonl`에 누적합니다.

## 주의

- 훅 payload 포맷이 환경마다 달라 여러 키를 탐색하도록 구현되어 있습니다.
- PR 생성은 `gh` CLI, 현재 브랜치, 원격 설정 상태에 따라 자동으로 skip될 수 있습니다.
- 로그 파일 경로는 저장소 루트의 `.codex-changes/changes.jsonl`입니다.
