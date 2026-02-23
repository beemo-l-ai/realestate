import { XMLParser } from "fast-xml-parser";
import { config } from "../lib/config.js";
import { RawTradeRow, TradeRecord } from "../lib/types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

const toNumber = (raw: string): number => Number(raw.replaceAll(",", "").trim());

const pad2 = (value: string): string => value.padStart(2, "0");

const makeTradeId = (row: RawTradeRow): string => {
  return [
    row.지역코드,
    row.법정동,
    row.아파트,
    row.년,
    pad2(row.월),
    pad2(row.일),
    row.전용면적,
    row.층,
    row.거래금액.replaceAll(",", ""),
  ]
    .join("|")
    .replaceAll(" ", "");
};

const parseRows = (xml: string): RawTradeRow[] => {
  const json = parser.parse(xml);
  const items = json.response?.body?.items?.item;

  if (!items) {
    return [];
  }

  return Array.isArray(items) ? items : [items];
};

export const collectTradesByMonth = async (
  districtCode: string,
  yearMonth: string,
  region: string,
): Promise<TradeRecord[]> => {
  if (!config.molitServiceKey) {
    throw new Error("MOLIT_SERVICE_KEY is required for live collection.");
  }

  const url = new URL(config.molitApiBase);
  url.searchParams.set("serviceKey", config.molitServiceKey);
  url.searchParams.set("LAWD_CD", districtCode);
  url.searchParams.set("DEAL_YMD", yearMonth);
  url.searchParams.set("numOfRows", "999");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`MOLIT API request failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const rows = parseRows(xml);

  return rows.map((row) => {
    const tradeDate = `${row.년}-${pad2(row.월)}-${pad2(row.일)}`;

    return {
      id: makeTradeId(row),
      region,
      districtCode,
      legalDong: row.법정동,
      apartmentName: row.아파트,
      areaM2: Number(row.전용면적),
      priceKrw: toNumber(row.거래금액) * 10_000,
      floor: Number(row.층),
      tradedAt: tradeDate,
      source: "MOLIT_RTMS",
      collectedAt: new Date().toISOString(),
    } satisfies TradeRecord;
  });
};
