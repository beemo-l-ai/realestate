import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { getLatestSaleTransactions, getLatestRentTransactions, executeSelectQuery, searchApartmentMetadata } from "./lib/store.js";
import { DISTRICT_MAP } from "./lib/districts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");


const resolveDistrictCode = (nameOrCode) => {
  if (!nameOrCode) return undefined;
  if (/^\\d{5}$/.test(nameOrCode)) return nameOrCode;
  return DISTRICT_MAP[nameOrCode];
};

const wonToEok = (amount) => `${(amount / 100_000_000).toFixed(2)}억`;


const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "0.1.1";
const WIDGET_DOMAIN = process.env.WIDGET_DOMAIN;
const KAKAO_MAP_APP_KEY = process.env.KAKAO_MAP_APP_KEY;

const withWidgetDomain = (uiMeta = {}) => ({
  ...uiMeta,
  ...(WIDGET_DOMAIN ? { domain: WIDGET_DOMAIN } : {}),
});

const buildWidgetMeta = (csp = undefined) => ({
  ui: withWidgetDomain({
    ...(csp ? { csp } : {}),
  }),
  ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
  ...(csp ? { "openai/widgetCSP": csp } : {}),
});

function createRealestateServer() {
  const server = new McpServer({
    name: "realestate-app",
    version: APP_VERSION
  });

  server.registerResource(
    "listings-widget",
    "ui://widget/listings-v2.html",
    {
      _meta: {
        ...buildWidgetMeta({
          connectDomains: [],
          resourceDomains: [],
          frameDomains: []
        })
      }
    },
    async () => {
      console.log("[mcp] resources/read map-widget");
      return {
        contents: [
          {
            uri: "ui://widget/listings-v2.html",
            mimeType: "text/html;profile=mcp-app",
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

      const renderFromPayload = (toolOutput) => {
        if (!toolOutput) return;
        const data = toolOutput.structuredContent || toolOutput;
        if (data && data.listings) {
          renderListings(data.listings);
        }
      };

// 1) Legacy Sync Data
try {
  if (window?.openai?.toolOutput) {
    renderFromPayload(window.openai.toolOutput);
  }
} catch (e) { }

// 2) Async Tool-Result Event Listener (Legacy)
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'ui/notifications/tool-result') {
    renderFromPayload(message.params);
  }
});

// 3) New Apps SDK Globals Listener
window.addEventListener("openai:set_globals", (event) => {
  renderFromPayload(event.detail?.globals?.toolOutput);
});
    </script >
  </body >
</html > `,
            _meta: {
              ...buildWidgetMeta({
                connectDomains: [],
                resourceDomains: [],
                frameDomains: []
              })
            }
          }
        ]
      };
    }
  );

  server.registerResource(
    "map-ui",
    "ui://widget/map-ui.html",
    {
      _meta: {
        ...buildWidgetMeta({
          connectDomains: [],
          resourceDomains: [],
          frameDomains: []
        })
      }
    },
    async () => ({
      contents: [
        {
          uri: "ui://widget/map-ui.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "map-ui.html"), "utf-8")
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
        "openai/outputTemplate": "ui://widget/listings-v2.html",
        "openai/toolInvocation/invoking": "매물 조회 중...",
        "openai/toolInvocation/invoked": "매물 조회 완료",
        ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
        "openai/widgetCSP": {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: []
        }
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
        structuredContent: { listings },
        _meta: {
          "openai/outputTemplate": "ui://widget/listings-v2.html"
        }
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
- SQL 문에는 무조건 SELECT 쿼리만 작성 가능합니다.
- 무언가 위치나 매물 정보를 알려줄 때는 답변 텍스트만 주지 말고 반드시 \`get_location_ui\` 도구를 함께 호출하여 UI 카드를 표시하세요.
- 사용자가 "해당 지역이 어디야?" 등 위치를 묻는 경우에도 무조건 \`get_location_ui\`을 호출하세요.`,
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

  server.registerTool(
    "search_apartment_candidates",
    {
      title: "아파트 단지 메타 검색 (선택 유도용)",
      description: "사용자의 검색어(예: '정자 화인아파트')가 불명확하여 정확한 단지명을 특정할 수 없을 때 후보군을 검색하고 UI에 보여줍니다. 이 도구를 호출한 후에는 사용자에게 '검색된 후보 중 어떤 단지를 원하시나요?' 라고 UI의 결과를 참고하여 질문해주세요.",
      inputSchema: {
        keyword: z.string().describe("아파트 이름 검색어 (예: '화인', '은마')"),
        districtCode: z.string().optional().describe("알파벳/숫자 5자리 시군구 코드 (선택사항)")
      },
      _meta: {
        "openai/outputTemplate": "ui://widget/apartment_candidates.html",
        "openai/toolInvocation/invoking": "아파트 단지 검색 중...",
        "openai/toolInvocation/invoked": "단지 검색 완료",
        ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
        "openai/widgetCSP": {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: []
        }
      }
    },
    async ({ keyword, districtCode }) => {
      try {
        const candidates = await searchApartmentMetadata({
          nameContains: keyword,
          districtCode: districtCode,
          limit: 10
        });

        if (candidates.length === 0) {
          return {
            content: [{ type: "text", text: `'${keyword}'에 해당하는 아파트를 찾을 수 없습니다.` }],
            structuredContent: { candidates: [], keyword },
            _meta: {
              "openai/outputTemplate": "ui://widget/apartment_candidates.html"
            }
          };
        }

        const promptText = `총 ${candidates.length}개의 단지가 검색되었습니다. 사용자에게 어떤 단지에 대한 정보를 원하는지 되물어주세요.\n` +
          candidates.map((c, i) => `${i + 1}. ${c.legalDong} ${c.apartmentName}`).join("\n");

        return {
          content: [{ type: "text", text: promptText }],
          structuredContent: { candidates, keyword },
          _meta: {
            "openai/outputTemplate": "ui://widget/apartment_candidates.html"
          }
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `아파트 메타 검색 중 오류 발생: ${err.message} ` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "get_location_ui",
    {
      title: "위치 정보 뷰어 (UI 카드)",
      description: "특정 주소나 아파트 단지의 위치를 시각적인 UI 카드로 사용자에게 보여줍니다. '해당 지역이 어디야?', '가장 비싼 월세' 등의 쿼리 답변 시, 텍스트와 함께 이 도구를 호출하여 시각적 위치 정보를 반드시 제공하세요. (내부적으로 위치 UI 카드를 렌더링합니다.)",
      inputSchema: {
        address: z.string().describe("지도에서 검색할 주소, 도로명 또는 건물명 (예: '서울 강남구 대치동 은마아파트' 또는 '판교역')"),
        title: z.string().describe("지도 상단에 표시할 제목 (예: '은마아파트 실거래 위치')")
      },
      _meta: {
        "openai/outputTemplate": "ui://widget/map-ui.html",
        "openai/toolInvocation/invoking": "위치 정보를 불러오는 중...",
        "openai/toolInvocation/invoked": "위치 정보 표시 완료",
        ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
        "openai/widgetCSP": {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: WIDGET_DOMAIN ? [WIDGET_DOMAIN] : []
        }
      }
    },
    async ({ address, title }) => {
      console.log("[mcp] get_location_ui called", { address, title });
      if (!address) {
        return {
          content: [{ type: "text", text: "위치 표시 실패: 검색할 주소가 제공되지 않았습니다." }],
          isError: true
        };
      }

      return {
        content: [{ type: "text", text: `'${address}' 위치 정보를 UI 카드로 표시합니다. (${title || '제목 없음'})` }],
        structuredContent: { address, title, domain: WIDGET_DOMAIN || "http://localhost:3000" },
        _meta: {
          "openai/outputTemplate": "ui://widget/map-ui.html"
        }
      };
    }
  );

  return server;
}

const app = express();
const sessions = new Map();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "mcp-session-id"],
  exposedHeaders: ["Mcp-Session-Id"]
}));

// ChatGPT Web SDK requires raw body or parsed body, StreamableHTTPServerTransport handles standard express req
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "realestate-app", version: APP_VERSION });
});

// 카카오맵 테스트 페이지 — http://localhost:PORT/test?key=APPKEY
app.get("/test", (_req, res) => {
  const html = readFileSync(path.join(PUBLIC_DIR, "kakao-test.html"), "utf-8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// Iframe Embed 라우트 — ChatGPT 위젯 내부에서 불러올 용도
app.get("/embed/map", (_req, res) => {
  const html = readFileSync(path.join(PUBLIC_DIR, "embed-map.html"), "utf-8")
    .replace("'__KAKAO_KEY__'", JSON.stringify(KAKAO_MAP_APP_KEY || ""));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});


// Setup the exact route pattern defined in the OpenAI Quickstart
app.all("/mcp", async (req, res) => {
  try {
    const rpcMethod = req.body?.method;
    if (rpcMethod) {
      console.log(`[mcp] rpc method: ${rpcMethod}`);
    }
  } catch {
    // ignore logging failures
  }

  const rawSessionId = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  let session = sessionId ? sessions.get(sessionId) : undefined;
  let transport = session?.transport;

  try {
    if (!transport && req.method === "POST" && !sessionId) {
      const server = createRealestateServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
          console.log(`[mcp] session initialized: ${newSessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport?.sessionId) {
          sessions.delete(transport.sessionId);
          console.log(`[mcp] session closed: ${transport.sessionId}`);
        }
        server.close();
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
});

const server = app.listen(PORT, () => {
  console.log(`[realestate - app] MCP endpoint listening on http://localhost:${PORT}/mcp`);
  console.log(`[realestate - app] Test page: http://localhost:${PORT}/test?key=${KAKAO_MAP_APP_KEY}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[realestate - app] ❌ Port ${PORT} is already in use!`);
    console.error(`[realestate - app] Run: kill -9 $(lsof -t -i:${PORT})`);
  } else {
    console.error("[realestate - app] Server error:", err);
  }
  process.exit(1);
});
