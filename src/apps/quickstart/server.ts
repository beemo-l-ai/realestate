import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { firestore } from "../../lib/firebase.js";

const UI_TEMPLATE_URI = "ui://realestate/trend-widget.html";

const server = new McpServer({
  name: "kr-realestate-apps-template",
  version: "0.1.0",
});

server.registerResource(
  "trend-widget",
  UI_TEMPLATE_URI,
  {
    title: "수도권 실거래가 위젯",
    description: "월별 평균 실거래가를 간단한 표로 렌더링하는 위젯 템플릿",
    mimeType: "text/html",
  },
  async () => ({
    contents: [
      {
        uri: UI_TEMPLATE_URI,
        mimeType: "text/html",
        text: `
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>수도권 실거래가 위젯</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; font-size: 13px; }
      th { background: #fafafa; text-align: left; }
      .muted { color: #666; font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <h3>수도권 실거래가 추이</h3>
    <div id="app">데이터를 불러오는 중...</div>
    <script>
      const root = document.getElementById("app");
      const payload = window?.openai?.toolOutput?.structuredContent;
      const rows = payload?.rows ?? [];

      if (!rows.length) {
        root.textContent = "표시할 데이터가 없습니다.";
      } else {
        const table = document.createElement("table");
        const bodyRows = rows
          .map((r) => "<tr><td>" + r.yearMonth + "</td><td>" + r.region + "</td><td>" + r.apartmentName + "</td><td>" + r.avgPriceKrw + "</td><td>" + r.txCount + "</td></tr>")
          .join("");
        table.innerHTML = "<thead><tr><th>년월</th><th>지역</th><th>아파트</th><th>평균가(원)</th><th>거래건수</th></tr></thead><tbody>" + bodyRows + "</tbody>";
        root.innerHTML = "";
        root.appendChild(table);
      }
    </script>
  </body>
</html>`,
      },
    ],
  }),
);

server.registerTool(
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
      "openai/outputTemplate": UI_TEMPLATE_URI,
    },
  },
  async ({ region, fromYm, toYm, limit }) => {
    let query = firestore
      .collection("apt_monthly_aggregates")
      .where("yearMonth", ">=", fromYm)
      .where("yearMonth", "<=", toYm)
      .orderBy("yearMonth", "desc")
      .limit(limit);

    if (region) {
      query = query.where("region", "==", region);
    }

    const snapshot = await query.get();
    const rows = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        yearMonth: data.yearMonth,
        region: data.region,
        apartmentName: data.apartmentName,
        avgPriceKrw: data.avgPriceKrw,
        txCount: data.txCount,
      };
    });

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

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
