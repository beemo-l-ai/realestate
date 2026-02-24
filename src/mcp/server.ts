import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { firestore } from "../lib/firebase.js";
import { DISTRICT_MAP } from "../lib/districts.js";

const server = new McpServer({
  name: "kr-realestate-mcp",
  version: "0.1.0",
});

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

server.registerTool(
  "get_districts",
  {
    title: "지원 지역 목록 조회",
    description: "시스템에서 지원하는 구 단위 지명 및 지역 코드 목록을 확인합니다.",
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
    inputSchema: {
      districtName: z.string().optional(),
      districtCode: z.string().optional(),
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

    const snapshot = await firestore
      .collection("apt_metadata")
      .where("districtCode", "==", code)
      .limit(1000)
      .get();

    let docs = snapshot.docs.map((doc) => doc.data() as any);

    if (input.nameContains) {
      docs = docs.filter(d => d.apartmentName.includes(input.nameContains!));
    }

    docs.sort((a, b) => b.totalTrades - a.totalTrades);

    const summaries = docs.map(d =>
      `${d.legalDong} ${d.apartmentName} | 평형: ${d.availableAreas.join(', ')}㎡ | 누적거래: ${d.totalTrades}건`
    );

    return {
      content: [
        {
          type: "text",
          text: summaries.length > 0 ? summaries.join("\n") : "해당 조건의 아파트 데이터가 없습니다.",
        },
      ],
      structuredContent: { docs }
    };
  },
);

server.registerTool(
  "search_realestate_trends",
  {
    title: "수도권 실거래가 추이 조회",
    description: "수도권(서울/경기/인천) 아파트 월별 실거래가 통계를 조회합니다. 아파트명을 입력하지 않으면 구 단위 전체 통계를 보여줍니다.",
    inputSchema: searchInputSchema,
  },
  async (input) => {
    const districtCode = input.districtCode || resolveDistrictCode(input.districtName);

    let query = firestore.collection("apt_monthly_aggregates")
      .where("yearMonth", ">=", input.fromYm)
      .where("yearMonth", "<=", input.toYm)
      .orderBy("yearMonth", "asc")
      .limit(120);

    if (input.region) {
      query = query.where("region", "==", input.region);
    }

    if (districtCode) {
      query = query.where("districtCode", "==", districtCode);
    }

    if (input.apartmentName) {
      query = query.where("apartmentName", "==", input.apartmentName);
    } else {
      // If no apartment is specified, use the district-level aggregates (where apartmentName is null)
      query = query.where("apartmentName", "==", null);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.map((doc) => doc.data());

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

    const points = docs.map((d) => ({ ym: d.yearMonth, avg: d.avgPriceKrw }));
    const chart = points
      .map((point) => `${point.ym}: ${wonToEok(point.avg)} ${"▇".repeat(Math.max(1, Math.round(point.avg / 200_000_000)))}`)
      .join("\n");

    const summary = docs
      .slice(0, 12)
      .map(
        (d) =>
          `${d.yearMonth} | ${d.region} ${d.districtCode} | ${d.apartmentName} | 평균 ${wonToEok(d.avgPriceKrw)} | 거래 ${d.txCount}건`,
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
            "※ 데이터 출처: 국토교통부 실거래가 공개시스템 API를 가공한 Firestore 집계",
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
    inputSchema: {
      region: z.enum(["서울", "경기", "인천"]).optional(),
      districtCode: z.string().optional(),
      districtName: z.string().optional().describe("구 단위 지명 (예: 강남구, 분당구)"),
      apartmentName: z.string().optional(),
      areaM2: z.number().optional().describe("전용면적(㎡). 메타데이터에서 확인된 크기를 지정하세요."),
      limit: z.number().int().min(1).max(30).default(10),
    },
  },
  async (input) => {
    const districtCode = input.districtCode || resolveDistrictCode(input.districtName);
    let query = firestore.collection("apt_transactions").orderBy("tradedAt", "desc").limit(input.limit);

    if (input.region) query = query.where("region", "==", input.region);
    if (districtCode) query = query.where("districtCode", "==", districtCode);
    if (input.apartmentName) query = query.where("apartmentName", "==", input.apartmentName);
    if (input.areaM2) query = query.where("areaM2", "==", input.areaM2);

    const snapshot = await query.get();
    const rows = snapshot.docs.map((doc) => doc.data());

    return {
      content: [
        {
          type: "text" as const,
          text: rows.length
            ? rows
              .map(
                (row) =>
                  `${row.tradedAt} | ${row.region} ${row.legalDong} ${row.apartmentName} ${row.areaM2}㎡ ${row.floor}층 | ${wonToEok(row.priceKrw)}`,
              )
              .join("\n")
            : "조건에 맞는 거래 사례가 없습니다.",
        },
      ],
      structuredContent: { rows },
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
