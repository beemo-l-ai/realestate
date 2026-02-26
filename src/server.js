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

const buildKeywordVariants = (rawKeyword) => {
  const raw = String(rawKeyword || "").trim();
  if (!raw) return [];

  const compact = raw.replace(/\s+/g, "");
  const stripped = compact
    .replace(/아파트|단지|마을|주공|타운|빌라|맨션/gi, "")
    .replace(/[()]/g, "")
    .trim();
  const tokenized = raw
    .split(/\s+/)
    .map((token) => token.replace(/아파트|단지|마을|주공|타운|빌라|맨션/gi, "").trim())
    .filter((token) => token.length >= 2);

  const variants = [raw, compact, stripped, ...tokenized].filter((value) => value && value.length >= 2);
  return [...new Set(variants)];
};

const KEYWORD_ALIAS_MAP = {
  화인: ["유천", "유천화인", "청솔마을유천"],
  청송: ["청솔"],
};

const APARTMENT_ALIAS_RULES = [
  {
    match: /청솔마을\(유천\)/,
    aliases: ["청솔마을2단지유천화인아파트", "유천화인아파트", "유천화인"],
  },
];

const normalizeForMatch = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\-_.·]/g, "");

const expandKeywordVariants = (variants) => {
  const expanded = [...variants];
  for (const variant of variants) {
    const aliasList = KEYWORD_ALIAS_MAP[variant];
    if (aliasList) expanded.push(...aliasList);
  }
  return [...new Set(expanded)];
};

const getApartmentAliases = (apartmentName) => {
  const aliases = [];
  for (const rule of APARTMENT_ALIAS_RULES) {
    if (rule.match.test(apartmentName)) aliases.push(...rule.aliases);
  }
  return [...new Set(aliases)];
};

const scoreCandidate = (candidate, variants, legalDong) => {
  const name = normalizeForMatch(candidate.apartmentName);
  const aliases = (candidate.aliases || []).map(normalizeForMatch);
  let score = Math.log10(Number(candidate.totalTrades || 1) + 1) * 5;

  for (const variant of variants.map(normalizeForMatch)) {
    if (!variant) continue;
    if (name === variant) score += 160;
    else if (name.startsWith(variant)) score += 120;
    else if (name.includes(variant)) score += 90;

    for (const alias of aliases) {
      if (alias === variant) score += 180;
      else if (alias.includes(variant)) score += 120;
    }
  }

  if (legalDong && candidate.legalDong === legalDong) score += 40;
  return score;
};


const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "0.1.1";
const WIDGET_DOMAIN = process.env.WIDGET_DOMAIN;
const KAKAO_MAP_APP_KEY = process.env.KAKAO_MAP_APP_KEY;

const withWidgetDomain = (uiMeta = {}) => ({
  ...uiMeta,
  ...(WIDGET_DOMAIN ? { domain: WIDGET_DOMAIN } : {}),
});

const buildWidgetMeta = (csp = undefined, outputTemplate = undefined) => {
  const finalCsp = csp || {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [
      ...(WIDGET_DOMAIN ? [WIDGET_DOMAIN] : []),
      "https://dapi.kakao.com",
      "https://map.kakao.com",
      "https://*.daumcdn.net"
    ]
  };
  
  return {
    ui: withWidgetDomain({
      csp: finalCsp,
    }),
    ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
    "openai/widgetCSP": finalCsp,
    ...(outputTemplate ? { "openai/outputTemplate": outputTemplate } : {}),
  };
};

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
          frameDomains: WIDGET_DOMAIN ? [WIDGET_DOMAIN] : []
        })
      }
    },
    async () => ({
      contents: [
        {
          uri: "ui://widget/map-ui.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "map-ui.html"), "utf-8"),
          _meta: {
            ...buildWidgetMeta({
              connectDomains: [],
              resourceDomains: [],
              frameDomains: WIDGET_DOMAIN ? [WIDGET_DOMAIN] : []
            })
          }
        }
      ]
    })
  );

  server.registerResource(
    "apartment-candidates-ui",
    "ui://widget/apartment_candidates.html",
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
          uri: "ui://widget/apartment_candidates.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "apartment_candidates.html"), "utf-8"),
          _meta: {
            ...buildWidgetMeta({
              connectDomains: [],
              resourceDomains: [],
              frameDomains: []
            })
          }
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
        _meta: buildWidgetMeta(undefined, "ui://widget/listings-v2.html")
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
- 사용자가 "해당 지역이 어디야?" 등 위치를 묻는 경우에도 무조건 \`get_location_ui\`을 호출하세요.
- [매우 중요] 사용자가 질문한 아파트 이름으로 쿼리했을 때 결과가 0건이라면, DB에 저장된 아파트 이름과 다를 수 있습니다. (예: 사용자는 "청송마을 화인"이라고 했으나 DB에는 "유천화인"). 이 경우 절대로 바로 "없습니다"라고 답하지 마시고, 반드시 'search_apartment_candidates' 도구를 이어서 호출해 비슷한 이름의 아파트를 찾아 사용자에게 질문하세요.`,
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
      description: `사용자의 검색어(예: '분당 정자 화인아파트', '청송마을 화인아파트')가 불명확하여 정확한 단지명을 특정할 수 없을 때 후보군을 검색하고 UI에 보여줍니다.
keyword는 원문 그대로 입력해도 됩니다. 서버에서 내부적으로 공백/접미어(아파트, 단지, 마을)를 정규화해 여러 변형으로 검색합니다.
만약 키워드 검색 결과가 없다면, 제공된 districtCode나 legalDong을 활용해 해당 지역의 단지 목록을 넓게 가져옵니다. 지역 정보도 없으면 전체 인기 단지 후보를 제한적으로 제공합니다.
이 도구를 호출한 후에는 여러 개의 리스트가 반환된다면 사용자에게 "검색된 후보 중 어떤 단지를 찾으시나요?"라고 반드시 되물어서 확인받은 후 원본 질문에 대한 SQL 쿼리를 다시 진행하세요.
UI에서 후보를 클릭하면 \`select_apartment_candidate\` 도구를 통해 선택값이 자동 전달될 수 있으므로, 해당 도구 결과를 우선 반영해 후속 조회를 진행하세요.`,
      inputSchema: {
        keyword: z.string().describe("사용자 원문 키워드 또는 단지명 일부 (예: '청송마을 화인아파트' 또는 '화인')"),
        districtCode: z.string().optional().describe("알파벳/숫자 5자리 시군구 코드 (선택사항)"),
        legalDong: z.string().optional().describe("읍면동 법정동 이름 (선택사항, 예: '정자동', '금곡동')")
      },
      _meta: {
        "openai/outputTemplate": "ui://widget/apartment_candidates.html",
        "openai/widgetAccessible": true,
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
    async ({ keyword, districtCode, legalDong }) => {
      try {
        const baseKeywordVariants = buildKeywordVariants(keyword);
        const keywordVariants = expandKeywordVariants(baseKeywordVariants);
        const candidateMap = new Map();

        for (const variant of keywordVariants) {
          const variantRows = await searchApartmentMetadata({
            nameContains: variant,
            districtCode,
            legalDong,
            limit: 20
          });
          for (const row of variantRows) {
            const aliases = getApartmentAliases(row.apartmentName);
            candidateMap.set(`${row.districtCode}|${row.legalDong}|${row.apartmentName}`, { ...row, aliases });
          }
          if (candidateMap.size >= 40) break;
        }

        let candidates = [...candidateMap.values()]
          .sort((a, b) => scoreCandidate(b, keywordVariants, legalDong) - scoreCandidate(a, keywordVariants, legalDong))
          .slice(0, 8);
        let fallbackMode = "none";

        if (candidates.length === 0 && (districtCode || legalDong)) {
          candidates = (await searchApartmentMetadata({
            districtCode,
            legalDong,
            limit: 200
          }))
            .map((row) => ({ ...row, aliases: getApartmentAliases(row.apartmentName) }))
            .sort((a, b) => scoreCandidate(b, keywordVariants, legalDong) - scoreCandidate(a, keywordVariants, legalDong))
            .slice(0, 8);
          fallbackMode = "regional";
        }

        if (candidates.length === 0) {
          candidates = (await searchApartmentMetadata({
            limit: 20
          }))
            .map((row) => ({ ...row, aliases: getApartmentAliases(row.apartmentName) }))
            .sort((a, b) => scoreCandidate(b, keywordVariants, legalDong) - scoreCandidate(a, keywordVariants, legalDong))
            .slice(0, 8);
          fallbackMode = "global";
        }

        if (candidates.length === 0) {
          return {
            content: [{ type: "text", text: `'${keyword}' 에 해당하는 아파트를 찾을 수 없으며, 해당 지역에 등록된 아파트도 찾지 못했습니다.` }],
            structuredContent: { candidates: [], keyword },
            _meta: {
              "openai/outputTemplate": "ui://widget/apartment_candidates.html"
            }
          };
        }

        let promptText = "";
        if (fallbackMode === "regional") {
          promptText = `'${keyword}' 키워드로 일치하는 아파트가 없어, 해당 지역(${legalDong || districtCode})의 전체 단지 ${candidates.length}개를 검색했습니다. 이 중에서 사용자가 찾는 단지명과 가장 유사한 것을 찾아, "혹시 찾으시는 아파트가 OOO 인가요?" 라고 먼저 물어보세요.\n`;
        } else if (fallbackMode === "global") {
          promptText = `'${keyword}' 키워드와 정확히 일치하는 단지가 없어 전체 데이터에서 거래가 많은 대표 단지 ${candidates.length}개를 먼저 제시합니다. 사용자에게 지역(시/구/동)을 한 번 더 확인하고, 해당 지역으로 재검색하도록 유도하세요.\n`;
        } else {
          promptText = `총 ${candidates.length}개의 단지가 검색되었습니다. 사용자에게 어떤 단지에 대한 정보를 원하는지 되물어주세요.\n`;
        }

        promptText += candidates.map((c, i) => {
          const aliasLabel = c.aliases && c.aliases.length ? ` (별칭: ${c.aliases.slice(0, 2).join(", ")})` : "";
          return `${i + 1}. ${c.legalDong} ${c.apartmentName}${aliasLabel}`;
        }).join("\n");

        return {
          content: [{ type: "text", text: promptText }],
          structuredContent: { candidates, keyword: fallbackMode === "none" ? keyword : (legalDong || districtCode || keyword), fallbackMode },
          _meta: buildWidgetMeta(undefined, "ui://widget/apartment_candidates.html")
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
    "select_apartment_candidate",
    {
      title: "아파트 후보 선택 전달 (UI 액션)",
      description: "아파트 후보 선택 UI에서 사용자가 누른 단지명을 MCP 서버로 전달합니다. 결과를 받은 뒤에는 선택된 단지명으로 후속 SQL 조회를 이어가세요.",
      inputSchema: {
        selectedText: z.string().describe("UI에서 사용자가 선택한 표시 텍스트"),
        apartmentName: z.string().optional().describe("선택된 정확한 단지명"),
        legalDong: z.string().optional().describe("선택된 법정동"),
        districtCode: z.string().optional().describe("선택된 시군구 코드")
      },
      _meta: {
        "openai/toolInvocation/invoking": "선택한 단지 확인 중...",
        "openai/toolInvocation/invoked": "선택 단지 확인 완료"
      }
    },
    async ({ selectedText, apartmentName, legalDong, districtCode }) => ({
      content: [
        {
          type: "text",
          text: `사용자가 후보 단지를 선택했습니다: ${selectedText}. 이 단지(${legalDong || "법정동 미상"} ${apartmentName || selectedText})를 기준으로 원래 질문에서 하려던 작업(시세/추이/건수 조회)을 즉시 이어서 실행하세요. 추가 확인 질문 없이 가능한 경우 바로 SQL 조회를 호출하세요.`
        }
      ],
      structuredContent: {
        selectedText,
        apartmentName: apartmentName || selectedText,
        legalDong: legalDong || null,
        districtCode: districtCode || null,
        autoContinuePrompt: `${legalDong || ""} ${apartmentName || selectedText} 기준으로 이전 요청을 계속 진행해줘.`
      }
    })
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
        _meta: buildWidgetMeta(undefined, "ui://widget/map-ui.html")
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
