import { XMLParser } from "fast-xml-parser";
import { config } from "../lib/config.js";
import { RawTradeRow, TradeRecord } from "../lib/types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

const toNumber = (raw: string): number => Number(raw.replaceAll(",", "").trim());

const pad2 = (value: string): string => value.padStart(2, "0");

const normalizeServiceKey = (serviceKey: string): string => {
  if (!serviceKey.includes("%")) {
    return serviceKey;
  }

  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
};

const asString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length ? normalized : undefined;
};

const pickValue = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return undefined;
};

const normalizeRow = (row: Record<string, unknown>): RawTradeRow | null => {
  const legalDong = pickValue(row, ["법정동", "법정동명", "umdNm"]);
  const apartment = pickValue(row, ["아파트", "아파트명", "aptNm"]);
  const year = pickValue(row, ["년", "년도", "dealYear"]);
  const month = pickValue(row, ["월", "dealMonth"]);
  const day = pickValue(row, ["일", "dealDay"]);
  const area = pickValue(row, ["전용면적", "excluUseAr"]);
  const amount = pickValue(row, ["거래금액", "거래금액(만원)", "dealAmount"]);
  const floor = pickValue(row, ["층", "floor"]);

  if (!legalDong || !apartment || !year || !month || !day || !area || !amount || !floor) {
    return null;
  }

  return {
    법정동: legalDong,
    아파트: apartment,
    년: year,
    월: month,
    일: day,
    전용면적: area,
    거래금액: amount,
    층: floor,
    지번: pickValue(row, ["지번", "jibun"]) ?? "",
    지역코드: pickValue(row, ["지역코드", "지역코드값", "sggCd"]) ?? "",
  };
};

const makeTradeId = (row: RawTradeRow, districtCode: string): string => {
  return [
    row.지역코드 || districtCode,
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

  const rows = Array.isArray(items) ? items : [items];
  return rows
    .map((row) => normalizeRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is RawTradeRow => row !== null);
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
  url.searchParams.set("serviceKey", normalizeServiceKey(config.molitServiceKey));
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
      id: makeTradeId(row, districtCode),
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
