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
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { getLatestSaleTransactions, getLatestRentTransactions, executeSelectQuery, searchApartmentMetadata, searchProperties } from "./lib/store.js";
import { DISTRICT_MAP } from "./lib/districts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");

const SEARCH_PROPERTIES_DEFAULT_LIMIT = 20;
const SEARCH_PROPERTIES_MAX_LIMIT = 100;
const MAX_APARTMENT_SEARCH_LIMIT = 8;
const MAX_KEYWORD_SEARCH_CANDIDATES = 40;
const APARTMENT_SEARCH_FALLBACK_LIMIT = 200;
const KRW_PER_EOK = 100_000_000;

const normalizeText = (value) => String(value || "").trim();

const normalizeLookupKey = (value) =>
  normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/[()\-_.·]/g, "")
    .toLowerCase();

const dedupePreservingOrder = (items) => {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const value = normalizeText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }

  return output;
};

const clampLimit = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.trunc(numeric);
  if (rounded <= 0) return fallback;
  return Math.min(SEARCH_PROPERTIES_MAX_LIMIT, Math.max(1, rounded));
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

const DISTRICT_NAME_CODE_BY_KEY = Object.fromEntries(
  Object.entries(DISTRICT_MAP).map(([name, code]) => [normalizeLookupKey(name), code]),
);

const LINE_DISTRICT_KEYWORD_MAP = {
  신분당선: ["11680", "41135", "41465"],
};

const LINE_DISTRICT_CODE_BY_KEY = Object.fromEntries(
  Object.entries(LINE_DISTRICT_KEYWORD_MAP).map(([keyword, codes]) => [
    normalizeLookupKey(keyword),
    dedupePreservingOrder(codes).filter((code) => /^\d{5}$/.test(code)),
  ]),
);

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

const resolveDistrictCodes = (districtCodes = []) => {
  if (!Array.isArray(districtCodes)) return [];

  const resolved = [];

  for (const item of districtCodes) {
    const normalized = normalizeLookupKey(item);
    if (!normalized) continue;

    if (/^\d{5}$/.test(normalized)) {
      resolved.push(normalized);
      continue;
    }

    const nameCode = DISTRICT_NAME_CODE_BY_KEY[normalized];
    if (nameCode) {
      resolved.push(nameCode);
      continue;
    }

    const lineCodes = LINE_DISTRICT_CODE_BY_KEY[normalized];
    if (lineCodes?.length) {
      resolved.push(...lineCodes);
    }
  }

  return dedupePreservingOrder(resolved);
};

const normalizeLegalDongs = (legalDongs = []) =>
  dedupePreservingOrder((legalDongs || [])
    .filter((value) => typeof value === "string")
    .map((value) => normalizeText(value))
    .filter((value) => value));

const formatAddressForMap = (row) => {
  const tokens = [
    normalizeText(row.region),
    normalizeText(row.legalDong),
    normalizeText(row.apartmentName),
  ];
  return tokens.join(" ").trim().replace(/\s+/g, " ");
};

const buildAddressesForMap = (rows) => {
  return dedupePreservingOrder(rows.map((row) => formatAddressForMap(row)).filter(Boolean));
};

const toKrwFromEok = (eokValue) => {
  const numeric = Number(eokValue);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric * KRW_PER_EOK);
};

const tradeTypeLabelForWidget = (tradeType) => {
  if (tradeType === "SALE") return "매매";
  if (tradeType === "JEONSE") return "전세";
  if (tradeType === "WOLSE") return "월세";
  return "";
};

const choosePriceRange = (priceKrw, priceEok) => {
  if (typeof priceKrw === "number") return priceKrw;
  if (typeof priceEok === "number") return toKrwFromEok(priceEok);
  return undefined;
};

const buildSearchPropertiesWidgetUrl = ({
  addresses,
  title,
  tradeType,
  minPriceKrw,
  maxPriceKrw,
  minAreaM2,
  maxAreaM2
}) => {
  if (!addresses || addresses.length === 0) return null;

  const widgetDomain = /^https?:\/\//.test(WIDGET_DOMAIN) ? WIDGET_DOMAIN : `https://${WIDGET_DOMAIN}`;
  const url = new URL("/embed/map", widgetDomain);
  const safeAddresses = addresses.slice(0, 20);

  url.searchParams.set("addresses", JSON.stringify(safeAddresses));
  url.searchParams.set("title", title || "실거래 지도");
  if (tradeType) {
    url.searchParams.set("searchType", tradeTypeLabelForWidget(tradeType));
  }
  if (typeof minPriceKrw === "number") {
    url.searchParams.set("minPrice", String(minPriceKrw));
  }
  if (typeof maxPriceKrw === "number") {
    url.searchParams.set("maxPrice", String(maxPriceKrw));
  }
  if (typeof minAreaM2 === "number") {
    url.searchParams.set("minArea", String(minAreaM2));
  }
  if (typeof maxAreaM2 === "number") {
    url.searchParams.set("maxArea", String(maxAreaM2));
  }

  return url.toString();
};

const isPropertyListingQuery = (query) => {
  const upper = String(query || "").toUpperCase();
  const usesTransactionTable = /\bRE_SALE_TRANSACTIONS\b|\bRE_RENT_TRANSACTIONS\b/.test(upper);
  if (!usesTransactionTable) return false;

  const hasAnalyticsOrRanking = /COUNT\s*\(|AVG\s*\(|SUM\s*\(|MIN\s*\(|MAX\s*\(|MEDIAN\s*\(|GROUP\s+BY|HAVING|ORDER\s+BY|FETCH\s+FIRST|LIMIT|RANK\(|DENSE_RANK\(|ROW_NUMBER\(|OVER\s*\(|PARTITION/i.test(upper);
  return !hasAnalyticsOrRanking;
};

const sortCandidates = (candidateRows, variants, legalDong) =>
  candidateRows
    .map((row) => ({ ...row, aliases: getApartmentAliases(row.apartmentName) }))
    .sort((a, b) => scoreCandidate(b, variants, legalDong) - scoreCandidate(a, variants, legalDong))
    .slice(0, MAX_APARTMENT_SEARCH_LIMIT);

const getTradeTypeForMap = (displayType) => {
  if (displayType === "매매") return "SALE";
  if (displayType === "전세") return "JEONSE";
  if (displayType === "월세") return "WOLSE";
  return null;
};


const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "0.1.1";
const WIDGET_DOMAIN = process.env.WIDGET_DOMAIN || `http://localhost:${PORT}`;
const KAKAO_MAP_APP_KEY = process.env.KAKAO_MAP_APP_KEY;

const KAKAO_CSP = {
  connectDomains: [
    "https://dapi.kakao.com",
    "https://*.daumcdn.net"
  ],
  resourceDomains: [
    "https://dapi.kakao.com",
    "https://*.daumcdn.net",
    "https://map.kakao.com",
    WIDGET_DOMAIN
  ],
  frameDomains: [
    WIDGET_DOMAIN,
    "https://map.kakao.com"
  ]
};

const DEFAULT_CSP = {
  connectDomains: [WIDGET_DOMAIN],
  resourceDomains: [WIDGET_DOMAIN],
  frameDomains: [WIDGET_DOMAIN]
};

function createRealestateServer() {
  const server = new McpServer({
    name: "realestate-app",
    version: APP_VERSION
  });

  let queryCount = 0;

  // 2. 지도 UI 위젯
  registerAppResource(
    server,
    "map-ui",
    "ui://widget/map-ui.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/map-ui.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "map-ui.html"), "utf-8"),
          _meta: {
            ui: {
              domain: WIDGET_DOMAIN,
              csp: KAKAO_CSP
            }
          }
        }
      ]
    })
  );

  // 3. 아파트 후보 선택 위젯
  registerAppResource(
    server,
    "apartment-candidates-ui",
    "ui://widget/apartment_candidates.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/apartment_candidates.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "apartment_candidates.html"), "utf-8"),
          _meta: {
            ui: {
              domain: WIDGET_DOMAIN,
              csp: DEFAULT_CSP
            }
          }
        }
      ]
    })
  );

  // 4. 시세 추이 위젯
  registerAppResource(
    server,
    "trend-widget-ui",
    "ui://widget/trend-widget.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/trend-widget.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(path.join(PUBLIC_DIR, "trend-widget.html"), "utf-8"),
          _meta: {
            ui: {
              domain: WIDGET_DOMAIN,
              csp: DEFAULT_CSP
            }
          }
        }
      ]
    })
  );

  server.registerTool(
    "search_properties",
    {
      title: "부동산 실거래/매물 조건부 검색 (데이터 조회용)",
      description: `조건에 맞는 매물/실거래 데이터를 안전하게 검색합니다. (매매, 전월세 모두 지원)
"~ 조건에 맞는 매물 찾아줘", "최근 실거래 사례 보여줘" 등의 요청에 **가장 먼저 사용**해야 하는 핵심 도구입니다.

여러 지역을 배열로 넘겨 한 번에 검색할 수 있습니다. (예: 신분당선 라인 = 강남구, 분당구, 수지구)
이 도구는 데이터를 조사하기 위한 용도입니다. 검색 결과를 모은 뒤 반드시 마지막에 단 한 번만 'get_location_ui'를 호출하여 사용자에게 지도를 띄워주세요.
'addressesForMap' 필드와 'widgetUrl'이 제공되며 각각 지도 UI 호출 또는 바로 링크 표시에 사용할 수 있습니다.
'지역(districtName, districtCodes), 법정동(legalDong/legalDongs), 가격(원/억) 모두 지원합니다.

답변 시 "실시간 매물"이라는 표현 대신 "실거래 사례 기준" 또는 "실거래 사례 기반 추천"으로 명시하세요.`,
      inputSchema: {
        tradeType: z.enum(["SALE", "JEONSE", "WOLSE"]).describe("매매, 전세, 월세"),
        region: z.string().optional().describe("지역 문자열 (예: '분당구', '성남시'). districtName/region 중 하나로 전달"),
        districtName: z.string().optional().describe("구 단위 지역명 (예: '분당구', '강남구', '신분당선')"),
        districtCodes: z.array(z.string()).optional().describe("시군구 코드/권역 키워드/시구명 배열 (예: [\"11680\", \"41135\", \"신분당선\"])"),
        legalDong: z.string().optional().describe("법정동 단일 이름 (예: '구미동')"),
        legalDongs: z.array(z.string()).optional().describe("여러 읍면동 법정동 이름 (예: 정자동, 금곡동)"),
        apartmentName: z.string().optional().describe("정확한 아파트 단지명 일부"),
        minPriceEok: z.number().optional().describe("최소 매매가/보증금 (단위: 억)"),
        maxPriceEok: z.number().optional().describe("최대 매매가/보증금 (단위: 억)"),
        minPriceKrw: z.number().optional().describe("최소 가격/보증금 (단위: 원, 예: 9억 = 900000000)"),
        maxPriceKrw: z.number().optional().describe("최대 가격/보증금 (단위: 원)"),
        minAreaM2: z.number().optional().describe("최소 전용면적 (㎡)"),
        maxAreaM2: z.number().optional().describe("최대 전용면적 (㎡)"),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("검색 시작일 (YYYY-MM-DD)"),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("검색 종료일 (YYYY-MM-DD)"),
        limit: z.number().int().min(1).max(SEARCH_PROPERTIES_MAX_LIMIT).default(SEARCH_PROPERTIES_DEFAULT_LIMIT).optional().describe("조회할 최대 결과 수 (기본 20, 최대 100)")
      },
      _meta: {
        "openai/toolInvocation/invoking": "조건에 맞는 실거래/매물 검색 중...",
        "openai/toolInvocation/invoked": "매물 검색 완료"
      }
    },
    async (input) => {
      try {
        const resolvedDistrictCodes = resolveDistrictCodes([
          ...(input.districtCodes || []),
          ...(input.region ? [input.region] : []),
          ...(input.districtName ? [input.districtName] : []),
        ]);

        const legalDongInputs = [
          ...(input.legalDongs || []),
          ...(input.legalDong ? [input.legalDong] : [])
        ];

        const normalizedInput = {
          ...input,
          districtCodes: resolvedDistrictCodes,
          legalDongs: normalizeLegalDongs(legalDongInputs),
          minPriceKrw: choosePriceRange(input.minPriceKrw, input.minPriceEok),
          maxPriceKrw: choosePriceRange(input.maxPriceKrw, input.maxPriceEok),
          limit: clampLimit(input.limit, SEARCH_PROPERTIES_DEFAULT_LIMIT),
        };

        const result = await searchProperties(normalizedInput);
        const addressesForMap = buildAddressesForMap(result.rows);
        const widgetUrl = buildSearchPropertiesWidgetUrl({
          addresses: addressesForMap,
          title: `${normalizedInput.tradeType} 조건 검색`,
          tradeType: normalizedInput.tradeType,
          minPriceKrw: normalizedInput.minPriceKrw,
          maxPriceKrw: normalizedInput.maxPriceKrw,
          minAreaM2: normalizedInput.minAreaM2,
          maxAreaM2: normalizedInput.maxAreaM2
        });

        const latestDate = result.summary.latestDate || "N/A";
        const avgPriceText = result.summary.avgPriceKrw === undefined ? "N/A" : wonToEok(result.summary.avgPriceKrw);
        const minPriceText = result.summary.minPriceKrw === undefined ? "N/A" : wonToEok(result.summary.minPriceKrw);
        const maxPriceText = result.summary.maxPriceKrw === undefined ? "N/A" : wonToEok(result.summary.maxPriceKrw);
        const addressesForMapNotice = addressesForMap.length === 0
          ? "\n[알림] 위젯 주소 생성이 빈 값입니다. 아파트명/지역 조건을 보강하거나 결과를 사용자에게 확인 요청해 주세요."
          : "\n[시스템 가이드] 조사된 데이터를 바탕으로 답변을 작성하고, 위젯을 띄우기 위해 제공된 addressesForMap을 사용하여 get_location_ui 도구를 한 번만 호출하세요.";
        const zeroResultNotice = result.summary.totalCount === 0
          ? "\n[권고] 0건입니다. 단지명/지역명을 보정한 뒤 `search_apartment_candidates` 또는 `search_apartment_metadata`로 재검색하면 정확도가 높아집니다."
          : "";

        let text = `조건에 맞는 매물/실거래 데이터를 총 ${result.summary.totalCount}건 찾았습니다.\n`;
        text += `최근 거래일: ${latestDate}\n`;
        text += `평균 가격: ${avgPriceText}\n`;
        text += `가격 범위: ${minPriceText} ~ ${maxPriceText}\n`;
        text += `조회 행수: ${result.rows.length}\n`;
        if (widgetUrl) {
          text += `지도 위젯: ${widgetUrl}\n`;
        }
        text += `${addressesForMapNotice}${zeroResultNotice}`;

        return {
          content: [{ type: "text", text }],
          structuredContent: {
            ...result,
            addressesForMap,
            widgetUrl
          }
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `검색 중 오류 발생: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "query_realestate_db",
    {
      title: "부동산 통계 및 시세 상세 쿼리 (핵심 도구)",
      description: `부동산 관련 모든 통계(거래건수, 평균가, 최고가 등)와 시세 추이 질문에는 반드시 이 도구를 사용해야 정확한 데이터를 얻을 수 있습니다.

[데이터 범위]
- 기간: 2024-01-01 ~ 2025-12-31 (현재 최신 기준일: 2025-12-31)
- 지원 지역 (8개 시군구): 11110(종로구), 11680(강남구), 11710(송파구), 41135(분당구), 41281(덕양구), 41465(수지구), 28177(미추홀구), 28237(부평구)

[주요 테이블 및 스키마]
1. re_sale_monthly_aggregates (매매 월별 통계): id, region, district_code, apartment_name, year_month, avg_price_krw, median_price_krw, min_price_krw, max_price_krw, tx_count
2. re_rent_monthly_aggregates (전/월세 월별 통계): id, region, district_code, apartment_name, rent_type, year_month, avg_deposit_krw, avg_monthly_rent_krw, tx_count
3. re_sale_transactions (매매 상세): traded_at, legal_dong, apartment_name, area_m2, floor, price_krw, district_code
4. re_rent_transactions (전월세 상세)

[필수 지침]
- "시세 알려줘", "거래량 어때?", "최근 최고가 얼마야?" 등 집계나 통계가 필요한 질문에만 이 도구로 SQL을 실행하세요.
- 단순 "XX 아파트 9억 이하 매물(실거래) 찾아줘" 같은 목록성 조회는 'search_properties' 도구를 우선 사용하세요.
- 단지명이 불명확하면 가장 먼저 'search_apartment_candidates' 도구를 호출하여 정확한 이름을 확인받으세요.
- 답변 시 "실시간 매물"이라는 표현은 피하고 "실거래 사례 기준" 또는 "실거래 사례 기반 추천"으로 명시하세요.`,
      inputSchema: {
        sqlQuery: z.string().describe("실행할 통계/건수 추출용 Oracle SQL SELECT 구문"),
        reason: z.string().min(1).describe("이 SQL이 필요한 이유(한 줄). 단순 목록성 조회 대신 통계/집계·랭킹 목적이어야 합니다.")
      },
      _meta: {
        "openai/toolInvocation/invoking": "부동산 고급 쿼리 분석 중...",
        "openai/toolInvocation/invoked": "쿼리 결과물 획득"
      }
    },
    async ({ sqlQuery, reason }) => {
      queryCount++;
      try {
        if (isPropertyListingQuery(sqlQuery)) {
          return {
            content: [{ 
              type: "text",
              text: `[안내] 단순 거래 상세 목록 조회는 'search_properties'로 대체하는 것이 권장됩니다.
사용자가 요청한 목적: ${normalizeText(reason)}`
            }],
            isError: true
          };
        }

        const rows = await executeSelectQuery(sqlQuery);
        let text = `쿼리 성공. 결과의 총 행 수: ${rows.length}\n` + JSON.stringify(rows, null, 2);

        if (rows.length === 0) {
          text += "\n\n[알림] 검색 결과가 0건입니다. 아파트 이름이 정확한지 확인이 필요합니다.";
          text += "\n'search_apartment_candidates' (또는 'search_apartment_metadata') 도구를 호출하여 정확한 단지명을 확인해 보세요.";
        }

        if (queryCount >= 2 && rows.length === 0) {
          text += "\n\n[강력 권고] query_realestate_db를 여러 번 시도했으나 결과를 찾지 못했습니다. 더 이상 SQL을 수정하지 말고, 반드시 'search_apartment_candidates' 도구를 호출하여 사용자에게 단지 선택을 유도하세요.";
        }

        return {
          content: [
            {
              type: "text",
              text
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

  const pickTopCandidates = async (searchParams, keywordVariants, legalDong) => {
    const rows = await searchApartmentMetadata(searchParams);
    return sortCandidates(rows, keywordVariants, legalDong);
  };

  const handleApartmentSearch = async ({ keyword, districtCode, legalDong }) => {
    try {
      const baseKeywordVariants = buildKeywordVariants(keyword);
      const keywordVariants = expandKeywordVariants(baseKeywordVariants);
      const candidateMap = new Map();

      for (const variant of keywordVariants) {
        const variantRows = await searchApartmentMetadata({
          nameContains: variant,
          districtCode,
          legalDong,
          limit: APARTMENT_SEARCH_FALLBACK_LIMIT
        });
        for (const row of variantRows) {
          const aliases = getApartmentAliases(row.apartmentName);
          candidateMap.set(`${row.districtCode}|${row.legalDong}|${row.apartmentName}`, { ...row, aliases });
        }
        if (candidateMap.size >= MAX_KEYWORD_SEARCH_CANDIDATES) break;
      }

      let candidates = sortCandidates([...candidateMap.values()], keywordVariants, legalDong);
      let fallbackMode = "none";

      if (candidates.length === 0 && (districtCode || legalDong)) {
        candidates = await pickTopCandidates({
          districtCode,
          legalDong,
          limit: APARTMENT_SEARCH_FALLBACK_LIMIT
        }, keywordVariants, legalDong);
        fallbackMode = "regional";
      }

      if (candidates.length === 0) {
        candidates = await pickTopCandidates({
          limit: MAX_APARTMENT_SEARCH_LIMIT,
        }, keywordVariants, legalDong);
        fallbackMode = "global";
      }

      if (candidates.length === 0) {
        return {
          content: [{ type: "text", text: `'${keyword}' 에 해당하는 아파트를 찾을 수 없으며, 해당 지역에 등록된 아파트도 찾지 못했습니다.` }],
          structuredContent: { candidates: [], keyword }
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
  };

  server.registerTool(
    "search_apartment_metadata",
    {
      title: "아파트 단지 메타 검색 (search_apartment_candidates와 동일)",
      description: "search_apartment_candidates 도구와 동일한 기능을 수행합니다. 사용자가 'search_apartment_metadata'를 언급하거나 단지 검색이 필요할 때 사용하세요.",
      inputSchema: {
        keyword: z.string().describe("사용자 원문 키워드 또는 단지명 일부 (예: '청송마을 화인아파트' 또는 '화인')"),
        districtCode: z.string().optional().describe("알파벳/숫자 5자리 시군구 코드 (선택사항)"),
        legalDong: z.string().optional().describe("읍면동 법정동 이름 (선택사항, 예: '정자동', '금곡동')")
      }
    },
    handleApartmentSearch
  );

  server.registerTool(
    "search_apartment_candidates",
    {
      title: "아파트 단지 메타 검색 (선택 유도용)",
      description: `사용자가 아파트 단지명을 언급하며 시세/매물/통계를 물어볼 때, 이름이 불명확하거나 정확한 단지명을 특정하기 위해 **가장 먼저** 호출하여 후보군을 검색하고 UI에 보여주는 도구입니다.
keyword는 원문 그대로 입력해도 됩니다. 서버에서 내부적으로 공백/접미어(아파트, 단지, 마을)를 정규화해 여러 변형으로 검색합니다.
만약 키워드 검색 결과가 없다면, 제공된 districtCode나 legalDong을 활용해 해당 지역의 단지 목록을 넓게 가져옵니다. 지역 정보도 없으면 전체 인기 단지 후보를 제한적으로 제공합니다.
이 도구를 호출한 후에는 여러 개의 리스트가 반환된다면 사용자에게 "검색된 후보 중 어떤 단지를 찾으시나요?"라고 반드시 되물어서 확인받은 후 원본 질문에 대한 SQL 쿼리를 다시 진행하세요.
UI에서 후보를 클릭하면 \`select_apartment_candidate\` 도구를 통해 선택값이 자동 전달될 수 있으므로, 해당 도구 결과를 우선 반영해 후속 조회를 진행하세요.
(별칭: search_apartment_metadata)`,
      inputSchema: {
        keyword: z.string().describe("사용자 원문 키워드 또는 단지명 일부 (예: '청송마을 화인아파트' 또는 '화인')"),
        districtCode: z.string().optional().describe("알파벳/숫자 5자리 시군구 코드 (선택사항)"),
        legalDong: z.string().optional().describe("읍면동 법정동 이름 (선택사항, 예: '정자동', '금곡동')")
      },
      _meta: {
        ui: { resourceUri: "ui://widget/apartment_candidates.html" },
        "openai/outputTemplate": "ui://widget/apartment_candidates.html",
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "아파트 단지 검색 중...",
        "openai/toolInvocation/invoked": "단지 검색 완료"
      }
    },
    handleApartmentSearch
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
          text: `[시스템 알림] 사용자가 후보 단지를 선택했습니다: ${selectedText}.
이 단지(${legalDong || "법정동 미상"} ${apartmentName || selectedText})를 기준으로 원래 질문에서 하려던 작업(시세/추이/건수 조회)을 즉시 이어서 실행하세요.
추가 확인 질문 없이 바로 'query_realestate_db' 도구를 호출하여 SQL 조회를 진행해야 합니다.`
        }
      ],
      structuredContent: {
        selectedText,
        apartmentName: apartmentName || selectedText,
        legalDong: legalDong || null,
        districtCode: districtCode || null,
        autoContinuePrompt: `${legalDong || ""} ${apartmentName || selectedText} 기준으로 원래 요청을 중단 없이 계속 진행해줘.`
      }
    })
  );

  const fetchRecentStatsByAddress = async (address, tradeType, areaM2) => {
    const tokens = normalizeText(address).split(/\s+/);
    const apartmentNameInput = tokens[tokens.length - 1];

    if (!apartmentNameInput) return null;
    
    const normalizedInput = normalizeLookupKey(apartmentNameInput);

    const query = `
      SELECT apartment_name, trade_type, area_m2, avg_price_krw, avg_deposit_krw, avg_monthly_rent_krw, tx_count
      FROM re_recent_area_stats
      WHERE REPLACE(REPLACE(REPLACE(apartment_name, '(', ''), ')', ''), ' ', '') = :norm_name
         OR apartment_name = :apt_name
      ORDER BY area_m2 ASC, trade_type DESC
    `;

    const rows = await executeSelectQuery(query, {
      norm_name: normalizedInput,
      apt_name: apartmentNameInput
    });

    if (rows.length === 0) return null;
    
    // Default to the actual matched apartment name
    const apartmentName = rows[0].APARTMENT_NAME;

    let parsedData = rows.map((row) => ({
      type: row.TRADE_TYPE,
      area: row.AREA_M2,
      avgPrice: row.AVG_PRICE_KRW,
      avgDeposit: row.AVG_DEPOSIT_KRW,
      avgRent: row.AVG_MONTHLY_RENT_KRW,
      count: row.TX_COUNT,
    }));

    if (areaM2) {
      parsedData.sort((a, b) => Math.abs(a.area - areaM2) - Math.abs(b.area - areaM2));
      const closestArea = parsedData[0].area;
      parsedData = parsedData.filter((d) => Math.abs(d.area - closestArea) <= 3);
      
      if (tradeType) {
        parsedData.sort((a, b) => {
          if (a.type === tradeType && b.type !== tradeType) return -1;
          if (a.type !== tradeType && b.type === tradeType) return 1;
          return 0;
        });
      }
    } else {
      if (tradeType) {
        parsedData.sort((a, b) => {
          if (a.type === tradeType && b.type !== tradeType) return -1;
          if (a.type !== tradeType && b.type === tradeType) return 1;
          return 0;
        });
      }
      parsedData = parsedData.slice(0, 4);
    }

    return {
      address,
      apartmentName,
      data: parsedData.slice(0, 4),
    };
  };

  server.registerTool(
    "get_location_ui",
    {
      title: "위치 정보 및 주변 시세 뷰어 (지도 위젯)",
      description: "특정 아파트 단지나 주소들의 위치를 지도에 표시하고, 주변의 1개월 평균 실거래 시세를 함께 보여줍니다. 'addresses' 배열에 여러 주소를 넣을 수 있으며, 'searchPattern'을 통해 보고 싶은 매물 종류(매매/전세/월세)와 평형대를 지정할 수 있습니다.",
      inputSchema: {
        addresses: z.array(z.string()).describe("지도에서 검색할 주소들의 배열. (예: ['서울 강남구 대치동 은마아파트', '서울 서초구 반포동 아크로리버파크'])"),
        title: z.string().describe("지도 상단에 표시할 제목 (예: '주요 아파트 실거래 위치')"),
        searchPattern: z.object({
          type: z.enum(["매매", "전세", "월세"]).optional().describe("시세를 조회할 거래 유형"),
          area: z.number().optional().describe("시세를 조회할 전용면적(㎡) 기준")
        }).optional().describe("지도에 표시할 평균 시세 기준 (평형, 거래유형)")
      },
      _meta: {
        ui: { resourceUri: "ui://widget/map-ui.html" },
        "openai/outputTemplate": "ui://widget/map-ui.html",
        "openai/toolInvocation/invoking": "위치 및 시세 정보를 불러오는 중...",
        "openai/toolInvocation/invoked": "지도 및 시세 표시 완료"
      }
    },
    async ({ addresses, title, searchPattern }) => {
      console.log("[mcp] get_location_ui called", { addresses, title, searchPattern });

      const targetAddresses = dedupePreservingOrder(
        (addresses || [])
          .map((addr) => normalizeText(addr))
          .filter((addr) => !!addr)
      );

      if (targetAddresses.length === 0) {
        return {
          content: [{ type: "text", text: "위치 표시 실패: 검색할 주소가 제공되지 않았습니다." }],
          isError: true
        };
      }

      // Fetch recent stats for these addresses if they are apartment names
      const stats = [];
      const tradeType = getTradeTypeForMap(searchPattern?.type);
      const areaM2 = searchPattern?.area ?? null;

      try {
        for (const addr of targetAddresses) {
          const recentStats = await fetchRecentStatsByAddress(addr, tradeType, areaM2);
          if (recentStats) {
            stats.push(recentStats);
          }
        }
      } catch (err) {
        console.error("Failed to fetch stats for map:", err);
      }

      const displayAddress = targetAddresses.length === 1 
        ? targetAddresses[0] 
        : `${targetAddresses[0]} 외 ${targetAddresses.length - 1}곳`;

      let summaryText = `'${displayAddress}' 위치를 지도 위젯으로 표시합니다.`;
      if (stats.length > 0) {
        summaryText += ` (최근 1개월 평균 시세 포함)`;
      }

      return {
        content: [{ type: "text", text: summaryText }],
        structuredContent: { 
          addresses: targetAddresses, 
          title, 
          searchPattern: searchPattern || {},
          stats,
          domain: WIDGET_DOMAIN || "http://localhost:3000" 
        },
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
app.use(express.static(PUBLIC_DIR));

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
  console.log(`\n[realestate - app] 🚀 MCP server is running!`);
  console.log(`--------------------------------------------------------`);
  console.log(`📍 MCP Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`🛠️  Local Widget Test URLs (브라우저에서 바로 확인):`);
  console.log(`   - 아파트 후보: http://localhost:${PORT}/apartment_candidates.html`);
  console.log(`   - 시세 추이:   http://localhost:${PORT}/trend-widget.html`);
  console.log(`   - 지도 UI:     http://localhost:${PORT}/map-ui.html`);
  console.log(`--------------------------------------------------------\n`);
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
