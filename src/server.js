import express from "express";
import cors from "cors";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getLatestSaleTransactions, getLatestRentTransactions, executeSelectQuery } from "./lib/store.js";
import { DISTRICT_MAP } from "./lib/districts.js";

const resolveDistrictCode = (nameOrCode) => {
  if (!nameOrCode) return undefined;
  if (/^\\d{5}$/.test(nameOrCode)) return nameOrCode;
  return DISTRICT_MAP[nameOrCode];
};

const wonToEok = (amount) => `${(amount / 100_000_000).toFixed(2)}억`;


const PORT = Number(process.env.PORT || 3000);

function createRealestateServer() {
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
          text: `< !doctype html >
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>매물 결과</title>
      <style>
        body {font - family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 12px; }
        .card {border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
        .price {font - weight: 700; color: #111827; }
        .title {font - weight: 500; margin-top: 4px; }
        .meta {color: #6b7280; font-size: 13px; margin-top: 4px; }
      </style>
    </head>
    <body>
      <div id="root">데이터를 불러오는 중...</div>
      <script>
        const root = document.getElementById("root");

      const renderListings = (listings) => {
        if (!Array.isArray(listings) || listings.length === 0) {
          root.textContent = "표시할 매물이 없습니다.";
        return;
        }
        root.innerHTML = listings.map(function(item) {
          return "<div class=\\"card\\">" +
        "<div class=\\"price\\">" + item.price + "</div>" +
      "<div class=\\"title\\">" + item.title + "</div>" +
    "<div class=\\"meta\\">" + item.city + " · " + item.type + "</div>" +
"</div>";
        }).join("");
      };

// 1) Legacy Sync Data
try {
  const data = window?.openai?.toolOutput?.structuredContent;
  if (data?.listings) {
    renderListings(data.listings);
  }
} catch (e) { }

// 2) Async Tool-Result Event Listener
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'ui/notifications/tool-result') {
    const listings = message.params?.structuredContent?.listings;
    if (listings) {
      renderListings(listings);
    }
  }
});
    </script >
  </body >
</html > `
        }
      ]
    })
  );

  server.registerTool(
    "search_listings",
    {
      title: "매물 검색 (UI용 샘플)",
      description: "주의: 통계나 건수 조회 목적이 아닙니다!! 오직 화면에 보여줄 소수의 '최근 실거래 샘플 5개'만 반환합니다. 전체 건수를 묻는 질문에는 절대 이 도구를 쓰지 말고 'query_realestate_db' 도구를 사용하세요.",
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
      const districtCode = resolveDistrictCode(city);
      let listings = [];

      try {
        if (type === "매매") {
          const rows = await getLatestSaleTransactions({
            districtCode,
            limit: 5,
          });
          listings = rows.map((row) => ({
            title: `${row.LEGAL_DONG} ${Math.floor(Number(row.AREA_M2))}㎡`,
            city: `${row.REGION} ${row.APARTMENT_NAME}`,
            type: "매매",
            price: `매매 ${wonToEok(Number(row.PRICE_KRW))}`,
          }));
        } else {
          const rentType = type === "전세" ? "JEONSE" : "WOLSE";
          const rows = await getLatestRentTransactions({
            districtCode,
            rentType,
            limit: 5,
          });
          listings = rows.map((row) => {
            const price = rentType === "JEONSE"
              ? `전세 ${wonToEok(Number(row.DEPOSIT_KRW))}`
              : `보증금 ${wonToEok(Number(row.DEPOSIT_KRW))} / 월 ${Math.floor(Number(row.MONTHLY_RENT_KRW) / 10000)}만`;

            return {
              title: `${row.LEGAL_DONG} ${Math.floor(Number(row.AREA_M2))}㎡`,
              city: `${row.REGION} ${row.APARTMENT_NAME}`,
              type,
              price,
            };
          });
        }

      } catch (err) {
        console.error("Failed to query DB for listings:", err);
      }

      if (listings.length === 0) {
        return {
          content: [{ type: "text", text: `${city} ${type} 매물을 찾을 수 없습니다.` }],
          structuredContent: { listings: [] }
        };
      }

      return {
        content: [{ type: "text", text: `${city} ${type} 최근 실거래 ${listings.length}건을 찾았습니다.` }],
        structuredContent: { listings }
      };
    }
  );

  server.registerTool(
    "query_realestate_db",
    {
      title: "지역 및 월별 부동산 상세 쿼리 (필수 도구)",
      description: `주의! 거래 건수, 통계, 다중 조건 조회 등을 묻는 모든 질문에는 반드시 이 도구를 사용하여 Raw SQL(SELECT)을 실행해야만 정확한 답을 할 수 있습니다. search_listings 도구는 샘플만 반환하므로 절대 사용하지 마세요.

사용 가능한 테이블 및 스키마 정보:

1. re_sale_monthly_aggregates (매매 월별 통계)
컬럼명: id, region(예: 서울), district_code(예: 11680), apartment_name, year_month(예: 202401), avg_price_krw, median_price_krw, min_price_krw, max_price_krw, tx_count(거래건수)
* 구 단위 집계 데이터의 경우 apartment_name 컬럼 값이 NULL 입니다.
예시 질문: "서울 24년 1월 매매(매매) 거래 건수 알려줘"
예시 쿼리: SELECT SUM(tx_count) FROM re_sale_monthly_aggregates WHERE region = '서울' AND year_month = '202401' AND apartment_name IS NULL

2. re_rent_monthly_aggregates (전/월세 월별 통계)
컬럼명: id, region, district_code, apartment_name, rent_type('JEONSE' 또는 'WOLSE'), year_month, avg_deposit_krw, avg_monthly_rent_krw, tx_count
* 구 단위 집계 시 apartment_name IS NULL 포함.
예시 질문: "서울 24년 1월 전월세 거래 건수 확인해줘"
예시 쿼리: SELECT SUM(tx_count) FROM re_rent_monthly_aggregates WHERE region = '서울' AND year_month = '202401' AND apartment_name IS NULL

3. re_sale_transactions (매매 실거래 상세 내역)
컬럼명: id, region, district_code, legal_dong(법정동), apartment_name, area_m2(면적), price_krw(가격), floor(층), traded_at(거래일, DATE 형식)

4. re_rent_transactions (전/월세 실거래 상세 내역)
컬럼명: id, region, district_code, legal_dong, apartment_name, rent_type, area_m2, deposit_krw, monthly_rent_krw, floor, contracted_at

지침:
- 구 코드는 제공된 district_map 등을 통해 알 수 있다면 district_code='11680' 형태로 쓰시고, 모른다면 지역명은 '서울' 같이 풀네임(region)을 사용하세요.
- 합산 통계(예: 총 거래 발생 건수)를 원할 경우 반드시 \`SELECT SUM(tx_count)\` 처럼 집계 함수를 포함한 SQL을 작성하세요.
- SQL 문에는 무조건 SELECT 쿼리만 작성 가능합니다.`,
      inputSchema: {
        sqlQuery: z.string().describe("실행할 통계/건수 추출용 Oracle SQL SELECT 구문 (예: SELECT SUM(tx_count) FROM ...)")
      },
      _meta: {
        "openai/toolInvocation/invoking": "부동산 고급 쿼리 분석 중...",
        "openai/toolInvocation/invoked": "쿼리 결과물 획득"
      }
    },
    async ({ sqlQuery }) => {
      try {
        const rows = await executeSelectQuery(sqlQuery);
        return {
          content: [
            {
              type: "text",
              text: `쿼리 성공. 결과의 총 행 수: ${rows.length}\n` + JSON.stringify(rows, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `통계 쿼리 실행 오류 (문법을 다시 검토해 안전한 SELECT만 사용하세요): ${err.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  return server;
}

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "mcp-session-id"],
  exposedHeaders: ["Mcp-Session-Id"]
}));

// ChatGPT Web SDK requires raw body or parsed body, StreamableHTTPServerTransport handles standard express req
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "realestate-app", version: "0.1.0" });
});

// Setup the exact route pattern defined in the OpenAI Quickstart
app.all("/mcp", async (req, res) => {
  const server = createRealestateServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.listen(PORT, () => {
  console.log(`[realestate - app] MCP endpoint listening on http://localhost:${PORT}/mcp`);
});
