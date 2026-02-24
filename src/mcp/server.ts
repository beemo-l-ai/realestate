import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { firestore } from "../lib/firebase.js";

const server = new McpServer({
  name: "kr-realestate-mcp",
  version: "0.1.0",
});

const wonToEok = (amount: number): string => `${(amount / 100_000_000).toFixed(2)}억`;

const searchInputSchema = {
  region: z.enum(["서울", "경기", "인천"]).optional(),
  districtCode: z.string().optional(),
  apartmentName: z.string().optional(),
  fromYm: z.string().regex(/^\d{6}$/),
  toYm: z.string().regex(/^\d{6}$/),
};

server.registerTool(
  "search_realestate_trends",
  {
    title: "수도권 실거래가 추이 조회",
    description: "수도권(서울/경기/인천) 아파트 월별 실거래가 통계를 조회하고 간단한 추세 시각화를 제공합니다.",
    inputSchema: searchInputSchema,
  },
  async (input) => {
    let query = firestore.collection("apt_monthly_aggregate_groups")
      .where("yearMonth", ">=", input.fromYm)
      .where("yearMonth", "<=", input.toYm)
      .orderBy("yearMonth", "asc")
      .limit(120);

    if (input.region) {
      query = query.where("region", "==", input.region);
    }

    if (input.districtCode) {
      query = query.where("districtCode", "==", input.districtCode);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs
      .flatMap((doc) => {
        const data = doc.data();
        return Array.isArray(data.items) ? data.items : [];
      })
      .filter((item) => !input.apartmentName || item.apartmentName === input.apartmentName)
      .sort((a, b) => String(a.yearMonth).localeCompare(String(b.yearMonth)));

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
      apartmentName: z.string().optional(),
      limit: z.number().int().min(1).max(30).default(10),
    },
  },
  async (input) => {
    let query = firestore.collection("apt_transaction_groups")
      .orderBy("lastTradedAt", "desc")
      .limit(Math.max(30, input.limit * 4));

    if (input.region) query = query.where("region", "==", input.region);
    if (input.districtCode) query = query.where("districtCode", "==", input.districtCode);

    const snapshot = await query.get();
    const rows = snapshot.docs
      .flatMap((doc) => {
        const data = doc.data();
        return Array.isArray(data.trades) ? data.trades : [];
      })
      .filter((row) => !input.apartmentName || row.apartmentName === input.apartmentName)
      .sort((a, b) => String(b.tradedAt).localeCompare(String(a.tradedAt)))
      .slice(0, input.limit);

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
