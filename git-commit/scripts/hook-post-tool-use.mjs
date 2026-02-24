#!/usr/bin/env node
import { appendLog, getPathsFromPayload, getToolName, parseStdinJson } from './change-log.mjs';

const payload = parseStdinJson();
const toolName = (getToolName(payload) || '').toLowerCase();

const isEditWriteTool =
  toolName.includes('edit') ||
  toolName.includes('write') ||
  toolName.includes('multiedit');

if (!isEditWriteTool) {
  process.exit(0);
}

const changedFiles = getPathsFromPayload(payload);
if (changedFiles.length > 0) {
  appendLog({ type: 'file_change', toolName, files: changedFiles });
}
