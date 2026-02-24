#!/usr/bin/env node
import { appendLog, getStringAtPaths, parseStdinJson } from './change-log.mjs';

const payload = parseStdinJson();
const intent = getStringAtPaths(payload, [
  'prompt',
  'user_prompt',
  'userPrompt',
  'message',
  'input',
  'event.prompt',
  'event.user_prompt',
  'event.userPrompt',
  'event.message',
  'data.prompt',
  'data.user_prompt',
  'data.userPrompt',
  'data.message'
]);

if (intent) {
  appendLog({ type: 'intent', intent });
}
