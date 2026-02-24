import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const PORT = Number(process.env.PORT || 3000);

const server = new McpServer({
  name: "realestate-app",
  version: "0.1.0"
});

server.registerResource(
  "listings-widget",
  "ui://widget/listings.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/listings.html",
        mimeType: "text/html",
        text: `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>매물 결과</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 12px; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
      .price { font-weight: 700; }
      .meta { color: #6b7280; font-size: 13px; }
    </style>
  </head>
  <body>
    <div id="root">데이터를 불러오는 중...</div>
    <script>
      const data = window?.openai?.toolOutput?.structuredContent;
      const root = document.getElementById("root");
      if (!data?.listings?.length) {
        root.textContent = "표시할 매물이 없습니다.";
      } else {
        root.innerHTML = data.listings.map(function(item) {
          return "<div class=\"card\">" +
            "<div class=\"price\">" + item.price + "</div>" +
            "<div>" + item.title + "</div>" +
            "<div class=\"meta\">" + item.city + " · " + item.type + "</div>" +
          "</div>";
        }).join("");
      }
    </script>
  </body>
</html>`
      }
    ]
  })
);

server.registerTool(
  "search_listings",
  {
    title: "매물 검색",
    description: "도시와 거래 유형(월세/전세/매매)으로 샘플 매물을 조회합니다.",
    inputSchema: {
      city: z.string().describe("예: 서울, 부산"),
      type: z.enum(["월세", "전세", "매매"]).default("월세")
    },
    _meta: {
      "openai/outputTemplate": "ui://widget/listings.html",
      "openai/toolInvocation/invoking": "매물 조회 중...",
      "openai/toolInvocation/invoked": "매물 조회 완료"
    }
  },
  async ({ city, type }) => {
    const listings = [
      { title: "역세권 오피스텔", city, type, price: "보증금 1,000 / 월 70" },
      { title: "신축 투룸", city, type, price: "보증금 2,000 / 월 95" },
      { title: "채광 좋은 원룸", city, type, price: "보증금 500 / 월 55" }
    ];

    return {
      content: [{ type: "text", text: `${city} ${type} 매물 ${listings.length}건을 찾았습니다.` }],
      structuredContent: { listings }
    };
  }
);

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "realestate-app", version: "0.1.0" });
});

let transport;

app.get(["/", "/sse"], async (req, res) => {
  console.log("New SSE connection requested");
  if (transport) {
    console.log("Closing existing transport for new connection");
    try {
      await server.close();
    } catch (e) {
      console.error("Error closing existing connection:", e);
    }
    transport = null;
  }

  const currentTransport = new SSEServerTransport("/mcp", res);
  transport = currentTransport;

  res.on("close", async () => {
    console.log("SSE connection closed by client");
    if (transport === currentTransport) {
      try {
        await server.close();
        transport = null;
      } catch (e) {
        console.error("Error closing server on disconnect:", e);
      }
    }
  });

  await server.connect(currentTransport);
});

app.post("/mcp", async (req, res) => {
  if (!transport) {
    res.status(500).json({ error: "No active SSE connection" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`[realestate-app] MCP endpoint listening on http://localhost:${PORT}/sse`);
});
