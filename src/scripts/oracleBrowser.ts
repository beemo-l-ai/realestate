import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeOraclePool, withOracleConnection } from "../lib/oracle.js";

const HOST = process.env.DB_BROWSER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.DB_BROWSER_PORT ?? "8787");
const DEFAULT_LIMIT = Number(process.env.DB_BROWSER_DEFAULT_LIMIT ?? "100");
const MAX_LIMIT = Number(process.env.DB_BROWSER_MAX_LIMIT ?? "500");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPathCandidates = [
  path.join(__dirname, "oracleBrowser.html"),
  path.join(process.cwd(), "src/scripts/oracleBrowser.html"),
];

const htmlPath = htmlPathCandidates.find((candidate) => fs.existsSync(candidate));
if (!htmlPath) {
  throw new Error("Cannot find oracleBrowser.html");
}

const html = fs.readFileSync(htmlPath, "utf8");

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const text = (res: http.ServerResponse, status: number, body: string) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
};

const normalizeTableName = (value: string): string | null => {
  const upper = value.toUpperCase();
  return /^[A-Z][A-Z0-9_$#]*$/.test(upper) ? upper : null;
};

const parseLimit = (value: string | null, fallback = DEFAULT_LIMIT): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
};

const isReadonlySql = (raw: string): boolean => {
  const sql = raw.trim().toLowerCase();
  if (!sql || sql.includes(";")) return false;
  if (!(sql.startsWith("select") || sql.startsWith("with"))) return false;

  const blocked = [
    "insert ",
    "update ",
    "delete ",
    "merge ",
    "drop ",
    "alter ",
    "truncate ",
    "create ",
    "grant ",
    "revoke ",
    "begin ",
    "declare ",
    "commit",
    "rollback",
  ];

  return !blocked.some((keyword) => sql.includes(keyword));
};

const listTables = async (search: string): Promise<string[]> => {
  const term = search.trim().toUpperCase();

  return await withOracleConnection(async (connection) => {
    const result = await connection.execute(
      `
      SELECT table_name
      FROM user_tables
      WHERE (:term IS NULL OR table_name LIKE :pattern)
      ORDER BY table_name
      `,
      {
        term: term || null,
        pattern: term ? `%${term}%` : null,
      }
    );

    const rows = (result.rows ?? []) as Array<{ TABLE_NAME?: string }>;
    return rows
      .map((row) => row.TABLE_NAME)
      .filter((value): value is string => typeof value === "string");
  });
};

const previewTableRows = async (tableName: string, limit: number): Promise<unknown[]> => {
  return await withOracleConnection(async (connection) => {
    const sql = `SELECT * FROM ${tableName} FETCH FIRST ${limit} ROWS ONLY`;
    const result = await connection.execute(sql);
    return (result.rows ?? []) as unknown[];
  });
};

const runReadonlyQuery = async (sql: string, limit: number): Promise<unknown[]> => {
  const boundedSql = `SELECT * FROM (${sql}) FETCH FIRST ${limit} ROWS ONLY`;

  return await withOracleConnection(async (connection) => {
    const result = await connection.execute(boundedSql);
    return (result.rows ?? []) as unknown[];
  });
};

const parseBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    text(res, 400, "Invalid request");
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tables") {
      const search = url.searchParams.get("search") ?? "";
      const tables = await listTables(search);
      json(res, 200, { tables });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/table/")) {
      const rawName = decodeURIComponent(url.pathname.replace("/api/table/", ""));
      const tableName = normalizeTableName(rawName);
      if (!tableName) {
        text(res, 400, "Invalid table name");
        return;
      }

      const limit = parseLimit(url.searchParams.get("limit"));
      const rows = await previewTableRows(tableName, limit);
      json(res, 200, { rows });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/query") {
      const body = (await parseBody(req)) as { sql?: string; limit?: number };
      const sql = typeof body.sql === "string" ? body.sql.trim() : "";
      const limit = parseLimit(String(body.limit ?? DEFAULT_LIMIT));

      if (!isReadonlySql(sql)) {
        text(res, 400, "Only read-only SELECT/WITH queries are allowed");
        return;
      }

      const rows = await runReadonlyQuery(sql, limit);
      json(res, 200, { rows });
      return;
    }

    text(res, 404, "Not Found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    text(res, 500, message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DB browser started on http://${HOST}:${PORT}`);
});

const shutdown = async () => {
  server.close();
  await closeOraclePool();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
