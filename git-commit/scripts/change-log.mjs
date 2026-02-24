import fs from 'node:fs';
import path from 'node:path';

export const LOG_DIR = path.resolve(process.cwd(), '.codex-changes');
export const LOG_PATH = path.join(LOG_DIR, 'changes.jsonl');

export function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function appendLog(entry) {
  ensureLogDir();
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
}

export function readLogs() {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }

  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function clearLogs() {
  ensureLogDir();
  fs.writeFileSync(LOG_PATH, '', 'utf8');
}

export function parseStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getStringAtPaths(obj, paths) {
  for (const p of paths) {
    const value = p.split('.').reduce((acc, key) => {
      if (acc && typeof acc === 'object') {
        return acc[key];
      }
      return undefined;
    }, obj);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function getToolName(payload) {
  return getStringAtPaths(payload, [
    'tool_name',
    'toolName',
    'tool.name',
    'event.tool_name',
    'event.toolName',
    'data.tool_name',
    'data.toolName',
    'hook_event.tool_name',
    'hook_event.toolName'
  ]);
}

export function getPathsFromPayload(payload) {
  const pathSet = new Set();

  const maybeArrays = [
    payload?.tool_input?.file_path,
    payload?.tool_input?.path,
    payload?.tool_input?.paths,
    payload?.toolInput?.file_path,
    payload?.toolInput?.path,
    payload?.toolInput?.paths,
    payload?.tool_output?.file_path,
    payload?.toolOutput?.file_path,
    payload?.event?.tool_input?.file_path,
    payload?.event?.tool_input?.path,
    payload?.event?.tool_input?.paths,
    payload?.event?.toolInput?.file_path,
    payload?.event?.toolInput?.path,
    payload?.event?.toolInput?.paths,
    payload?.data?.tool_input?.file_path,
    payload?.data?.tool_input?.path,
    payload?.data?.tool_input?.paths,
    payload?.data?.toolInput?.file_path,
    payload?.data?.toolInput?.path,
    payload?.data?.toolInput?.paths
  ];

  for (const value of maybeArrays) {
    if (typeof value === 'string' && value.trim()) {
      pathSet.add(value.trim());
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          pathSet.add(item.trim());
        }
      }
    }
  }

  return Array.from(pathSet);
}
