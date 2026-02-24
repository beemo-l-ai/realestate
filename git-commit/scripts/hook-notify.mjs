#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { appendLog, getPathsFromPayload, getStringAtPaths, parseStdinJson } from './change-log.mjs';

function runIgnoreError(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function inferChangedFilesFromGit() {
  const porcelain = runIgnoreError('git status --porcelain');
  if (!porcelain) return [];

  return porcelain
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(3).trim();
      return file.includes(' -> ') ? file.split(' -> ').pop() : file;
    });
}

const payload = parseStdinJson();

const intent = getStringAtPaths(payload, [
  'prompt',
  'user_prompt',
  'userPrompt',
  'input',
  'turn.input',
  'event.prompt',
  'event.input',
  'data.prompt',
  'data.input',
  'last_user_message',
  'lastUserMessage'
]);
if (intent) {
  appendLog({ type: 'intent', source: 'notify', intent });
}

const payloadFiles = getPathsFromPayload(payload);
const gitFiles = inferChangedFilesFromGit();
const files = Array.from(new Set([...payloadFiles, ...gitFiles]));
if (files.length > 0) {
  appendLog({ type: 'file_change', source: 'notify', files });
}

appendLog({
  type: 'notify_event',
  source: 'codex_notify',
  sessionId:
    getStringAtPaths(payload, ['session_id', 'sessionId', 'session.id', 'event.session_id']) ||
    null
});
