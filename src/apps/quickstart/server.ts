import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { searchSaleMonthlyTrends } from "../../lib/store.js";

const UI_TEMPLATE_URI = "ui://realestate/trend-widget.html";
const widgetHtml = readFileSync(new URL("../../../public/trend-widget.html", import.meta.url), "utf8");
const WIDGET_DOMAIN = process.env.WIDGET_DOMAIN || "http://localhost:8787";

const server = new McpServer({
  name: "kr-realestate-apps-template",
  version: "0.2.0",
});

registerAppResource(server, "trend-widget", UI_TEMPLATE_URI, {}, async () => ({
  contents: [
    {
      uri: UI_TEMPLATE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: {
        ui: {
          domain: WIDGET_DOMAIN,
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
          },
        },
      },
    },
  ],
}));

registerAppTool(
  server,
  "get_capital_region_monthly_trends",
  {
    title: "수도권 월별 실거래가 추이 조회",
    description: "서울/경기/인천 기준 아파트 월별 평균 실거래가를 조회합니다.",
    inputSchema: {
      region: z.enum(["서울", "경기", "인천"]).optional(),
      fromYm: z.string().regex(/^\d{6}$/),
      toYm: z.string().regex(/^\d{6}$/),
      limit: z.number().int().min(1).max(120).default(24),
    },
    outputSchema: {
      rows: z.array(
        z.object({
          yearMonth: z.string(),
          region: z.string(),
          apartmentName: z.string(),
          avgPriceKrw: z.number(),
          txCount: z.number(),
        }),
      ),
    },
    _meta: {
      ui: { resourceUri: UI_TEMPLATE_URI },
      "openai/outputTemplate": UI_TEMPLATE_URI,
    },
  },
  async ({ region, fromYm, toYm, limit }: { region?: "서울" | "경기" | "인천"; fromYm: string; toYm: string; limit: number }) => {
    const docs = await searchSaleMonthlyTrends({
      region,
      fromYm,
      toYm,
      limit,
    });

    const rows = docs
      .map((item) => ({
        yearMonth: String(item.YEAR_MONTH),
        region: String(item.REGION),
        apartmentName: String(item.APARTMENT_NAME ?? "구단위"),
        avgPriceKrw: Number(item.AVG_PRICE_KRW),
        txCount: Number(item.TX_COUNT),
      }))
      .slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: rows.length
            ? `조회 결과 ${rows.length}건을 찾았습니다. 위젯에서 상세 추이를 확인하세요.`
            : "조건에 맞는 월별 집계 데이터가 없습니다.",
        },
      ],
      structuredContent: {
        rows,
      },
    };
  },
);

const MCP_PATH = "/mcp";
const port = Number(process.env.PORT ?? 8787);

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (url.pathname !== MCP_PATH) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(port, () => {
  console.log(`[apps] MCP server listening: http://localhost:${port}${MCP_PATH}`);
});
