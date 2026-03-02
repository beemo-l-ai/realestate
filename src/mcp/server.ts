import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { z } from "zod";
import { DISTRICT_MAP } from "../lib/districts.js";
import {
  getLatestRentTransactions,
  getLatestSaleTransactions,
  searchApartmentMetadata,
  searchSaleMonthlyTrends,
} from "../lib/store.js";

const wonToEok = (amount: number): string => `${(amount / 100_000_000).toFixed(2)}억`;

const resolveDistrictCode = (nameOrCode?: string): string | undefined => {
  if (!nameOrCode) return undefined;
  if (/^\d{5}$/.test(nameOrCode)) return nameOrCode;
  return DISTRICT_MAP[nameOrCode];
};

const searchInputSchema = {
  region: z.enum(["서울", "경기", "인천"]).optional(),
  districtCode: z.string().optional(),
  districtName: z.string().optional().describe("구 단위 지명 (예: 강남구, 분당구)"),
  apartmentName: z.string().optional(),
  fromYm: z.string().regex(/^\d{6}$/),
  toYm: z.string().regex(/^\d{6}$/),
};

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: "kr-realestate-mcp",
    version: "0.2.0",
  });

  server.registerTool(
    "get_districts",
    {
      title: "지원 지역 목록 조회",
      description: "시스템에서 지원하는 구 단위 지명 및 지역 코드 목록을 확인합니다.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () => {
      const list = Object.entries(DISTRICT_MAP)
        .map(([name, code]) => `${name}: ${code}`)
        .join("\n");
      return {
        content: [{ type: "text", text: list }],
      };
    },
  );

  server.registerTool(
    "search_apartment_metadata",
    {
      title: "지역 내 아파트 메타데이터 조회",
      description: "특정 지역(구/시)에 포함된 아파트의 상세 정보(보유 평형, 거래량 등)를 조회합니다. 아파트 이름 일부를 입력하여 필터링할 수 있습니다.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        districtName: z.string().optional(),
        districtCode: z.string().optional(),
        legalDong: z.string().optional().describe("법정동 이름 (예: 대치동, 반포동)"),
        nameContains: z.string().optional().describe("아파트 이름 검색어 (예: '래미안')"),
      },
    },
    async (input) => {
      const code = input.districtCode || resolveDistrictCode(input.districtName);
      if (!code) {
        return {
          content: [{ type: "text", text: "정확한 지역명이나 지역코드를 입력해주세요." }],
        };
      }

      const docs = await searchApartmentMetadata({
        districtCode: code,
        legalDong: input.legalDong,
        nameContains: input.nameContains,
        limit: 1000,
      });

      const summaries = docs.map((d) =>
        `${d.legalDong} ${d.apartmentName} | 평형: ${d.availableAreas.join(", ")}㎡ | 누적거래: ${d.totalTrades}건`,
      );

      return {
        content: [
          {
            type: "text",
            text: summaries.length > 0 ? summaries.join("\n") : "해당 조건의 아파트 데이터가 없습니다.",
          },
        ],
        structuredContent: { docs },
      };
    },
  );

  server.registerTool(
    "search_realestate_trends",
    {
      title: "수도권 실거래가 추이 조회",
      description: "수도권(서울/경기/인천) 아파트 월별 실거래가 통계를 조회합니다. 아파트명을 입력하지 않으면 구 단위 전체 통계를 보여줍니다.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: searchInputSchema,
    },
    async (input) => {
      const districtCode = input.districtCode || resolveDistrictCode(input.districtName);

      const docs = await searchSaleMonthlyTrends({
        region: input.region,
        districtCode,
        apartmentName: input.apartmentName,
        fromYm: input.fromYm,
        toYm: input.toYm,
        limit: 120,
      });

      if (docs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "조건에 맞는 수도권 실거래가 집계 데이터가 없습니다.",
            },
          ],
        };
      }

      const points = docs.map((d) => ({ ym: String(d.YEAR_MONTH), avg: Number(d.AVG_PRICE_KRW) }));
      const chart = points
        .map((point) => `${point.ym}: ${wonToEok(point.avg)} ${"▇".repeat(Math.max(1, Math.round(point.avg / 200_000_000)))}`)
        .join("\n");

      const summary = docs
        .slice(0, 12)
        .map(
          (d) =>
            `${String(d.YEAR_MONTH)} | ${String(d.REGION)} ${String(d.DISTRICT_CODE)} | ${String(d.APARTMENT_NAME ?? "구단위")}` +
            ` | 평균 ${wonToEok(Number(d.AVG_PRICE_KRW))} | 거래 ${Number(d.TX_COUNT)}건`,
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "[수도권 실거래가 조회 결과]",
              summary,
              "",
              "[월별 평균가 시각화(텍스트)]",
              chart,
              "",
              "※ 데이터 출처: 국토교통부 실거래가 공개시스템 API를 가공한 Oracle 집계",
            ].join("\n"),
          },
        ],
        structuredContent: {
          results: docs,
          chartPoints: points,
        },
      };
    },
  );

  server.registerTool(
    "get_latest_transaction_examples",
    {
      title: "수도권 최신 거래 사례 조회",
      description: "조건에 맞는 최근 실거래 개별 사례를 조회합니다(수도권 한정).",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        region: z.enum(["서울", "경기", "인천"]).optional(),
        districtCode: z.string().optional(),
        districtName: z.string().optional().describe("구 단위 지명 (예: 강남구, 분당구)"),
        legalDong: z.string().optional().describe("법정동 이름 (예: 대치동, 반포동)"),
        apartmentName: z.string().optional().describe("정확한 아파트명(예: '래미안푸르지오'). 띄어쓰기 등 정확한 이름을 모를 경우 search_apartment_metadata 도구로 먼저 확인 권장."),
        areaM2: z.number().optional().describe("전용면적(㎡). 예: 84 (소수점은 무시하고 앞자리로 검색됨)"),
        limit: z.number().int().min(1).max(30).default(10),
      },
    },
    async (input) => {
      const districtCode = input.districtCode || resolveDistrictCode(input.districtName);
      const rows = await getLatestSaleTransactions({
        region: input.region,
        districtCode,
        legalDong: input.legalDong,
        apartmentName: input.apartmentName,
        areaM2: input.areaM2,
        limit: input.limit,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: rows.length
              ? rows
                .map(
                  (row) =>
                    `${String(row.TRADED_AT)} | ${String(row.REGION)} ${String(row.LEGAL_DONG)} ` +
                    `${String(row.APARTMENT_NAME)} ${Number(row.AREA_M2)}㎡ ${Number(row.FLOOR)}층 | ${wonToEok(Number(row.PRICE_KRW))}`,
                )
                .join("\n")
              : "조건에 맞는 거래 사례가 없습니다.",
          },
        ],
        structuredContent: { rows },
      };
    },
  );

  server.registerTool(
    "get_latest_rent_examples",
    {
      title: "수도권 전월세 거래 사례 조회",
      description: "조건에 맞는 최근 전세/월세 거래 사례를 조회합니다.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        region: z.enum(["서울", "경기", "인천"]).optional(),
        districtCode: z.string().optional(),
        districtName: z.string().optional().describe("구 단위 지명 (예: 강남구, 분당구)"),
        legalDong: z.string().optional().describe("법정동 이름 (예: 대치동, 반포동)"),
        apartmentName: z.string().optional().describe("정확한 아파트명(예: '래미안푸르지오'). 띄어쓰기 등 정확한 이름을 모를 경우 search_apartment_metadata 도구로 먼저 확인 권장."),
        areaM2: z.number().optional().describe("전용면적(㎡). 예: 84 (소수점은 무시하고 앞자리로 검색됨)"),
        rentType: z.enum(["JEONSE", "WOLSE"]).optional().describe("JEONSE=전세, WOLSE=월세"),
        limit: z.number().int().min(1).max(30).default(10),
      },
    },
    async (input) => {
      const districtCode = input.districtCode || resolveDistrictCode(input.districtName);
      const rows = await getLatestRentTransactions({
        region: input.region,
        districtCode,
        legalDong: input.legalDong,
        apartmentName: input.apartmentName,
        areaM2: input.areaM2,
        rentType: input.rentType,
        limit: input.limit,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: rows.length
              ? rows
                .map(
                  (row) =>
                    `${String(row.CONTRACTED_AT)} | ${String(row.REGION)} ${String(row.LEGAL_DONG)} ${String(row.APARTMENT_NAME)}` +
                    ` ${Number(row.AREA_M2)}㎡ ${Number(row.FLOOR)}층 | ${String(row.RENT_TYPE)} | 보증금 ${wonToEok(Number(row.DEPOSIT_KRW))}` +
                    ` / 월세 ${wonToEok(Number(row.MONTHLY_RENT_KRW))}`,
                )
                .join("\n")
              : "조건에 맞는 전월세 거래 사례가 없습니다.",
          },
        ],
        structuredContent: { rows },
      };
    },
  );

  return server;
};

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  if (req.path === "/mcp" || req.path === "/sse" || req.path === "/messages") {
    console.log(`[http] ${req.method} ${req.path}`);
  }
  next();
});

const sseSessions = new Map<string, { server: McpServer; transport: SSEServerTransport }>();
const streamableSessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

app.get("/sse", async (req, res) => {
  const server = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  sseSessions.set(sessionId, { server, transport });

  transport.onclose = () => {
    sseSessions.delete(sessionId);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sseSessions.delete(sessionId);
    throw error;
  }
});

app.post("/messages", async (req, res) => {
  const sessionIdFromQuery = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionIdFromHeader = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  const sessionId = sessionIdFromQuery || sessionIdFromHeader;

  if (!sessionId) {
    res.status(400).send("Missing sessionId");
    return;
  }

  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).send("Unknown sessionId");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error handling MCP SSE message:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

const handleStreamableMcpRequest = async (req: express.Request, res: express.Response) => {
  const rawSessionId = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  const session = sessionId ? streamableSessions.get(sessionId) : undefined;
  let transport = session?.transport;

  try {
    if (!transport && req.method === "POST" && !sessionId) {
      const server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          streamableSessions.set(newSessionId, { server, transport: transport! });
          console.log(`[mcp] session initialized: ${newSessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport?.sessionId) {
          streamableSessions.delete(transport.sessionId);
          console.log(`[mcp] session closed: ${transport.sessionId}`);
        }
        void server.close();
      };

      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing mcp-session-id" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
};

app.all("/mcp", handleStreamableMcpRequest);
// Some scanners still try POST /sse before/while probing legacy SSE.
// Accepting streamable MCP on POST /sse improves compatibility.
app.post("/sse", handleStreamableMcpRequest);

app.get("/health", (_req, res) => {
  res.json({ ok: true, sseSessions: sseSessions.size, streamableSessions: streamableSessions.size });
});

process.on("SIGTERM", () => {
  for (const { transport } of sseSessions.values()) {
    void transport.close();
  }
  for (const { transport } of streamableSessions.values()) {
    void transport.close();
  }
  sseSessions.clear();
  streamableSessions.clear();
});

process.on("SIGINT", () => {
  for (const { transport } of sseSessions.values()) {
    void transport.close();
  }
  for (const { transport } of streamableSessions.values()) {
    void transport.close();
  }
  sseSessions.clear();
  streamableSessions.clear();
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`MCP Server running on http://0.0.0.0:${port}/mcp (streamable)`);
  console.log(`Legacy SSE endpoint: http://0.0.0.0:${port}/sse`);
});

app.use((_req, res) => {
  if (!res.headersSent) {
    res.status(503).send("SSE transport not initialized yet.");
  }
});
