import { firestore } from "./firebase.js";
import { MonthlyAggregate, MonthlyAggregateGroupDocument, TradeGroupDocument, TradeRecord } from "./types.js";

const tradeGroupCollection = firestore.collection("apt_transaction_groups");
const monthlyGroupCollection = firestore.collection("apt_monthly_aggregate_groups");

const normalizeGroupKey = (value: string): string => value.replaceAll("|", " ").trim();

const makeTradeGroupId = (record: TradeRecord): string => {
  const ym = record.tradedAt.slice(0, 7).replace("-", "");
  const groupKey = `${normalizeGroupKey(record.legalDong)}|${normalizeGroupKey(record.apartmentName)}`;
  return `${record.region}|${record.districtCode}|${ym}|${groupKey}`;
};

export const upsertTrades = async (records: TradeRecord[]): Promise<void> => {
  if (records.length === 0) return;

  const bucket = new Map<string, TradeRecord[]>();

  for (const record of records) {
    const groupId = makeTradeGroupId(record);
    const list = bucket.get(groupId) ?? [];
    list.push(record);
    bucket.set(groupId, list);
  }

  const batch = firestore.batch();

  for (const [id, trades] of bucket.entries()) {
    const first = trades[0];
    const sortedByDate = [...trades].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));
    const doc: TradeGroupDocument = {
      id,
      region: first.region,
      districtCode: first.districtCode,
      yearMonth: first.tradedAt.slice(0, 7).replace("-", ""),
      groupKey: `${normalizeGroupKey(first.legalDong)}|${normalizeGroupKey(first.apartmentName)}`,
      legalDong: first.legalDong,
      apartmentName: first.apartmentName,
      trades: sortedByDate,
      txCount: trades.length,
      lastTradedAt: sortedByDate[0]?.tradedAt ?? "",
    };

    batch.set(tradeGroupCollection.doc(id), doc, { merge: true });
  }

  await batch.commit();
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
};

export const makeMonthlyAggregates = (records: TradeRecord[]): MonthlyAggregate[] => {
  const bucket = new Map<string, TradeRecord[]>();

  for (const record of records) {
    const ym = record.tradedAt.slice(0, 7).replace("-", "");
    const key = `${record.region}|${record.districtCode}|${record.apartmentName}|${ym}`;
    const list = bucket.get(key) ?? [];
    list.push(record);
    bucket.set(key, list);
  }

  return [...bucket.entries()].map(([key, list]) => {
    const [region, districtCode, apartmentName, yearMonth] = key.split("|");
    const prices = list.map((item) => item.priceKrw);
    const sum = prices.reduce((acc, value) => acc + value, 0);

    return {
      region,
      districtCode,
      apartmentName,
      yearMonth,
      avgPriceKrw: Math.round(sum / prices.length),
      medianPriceKrw: median(prices),
      minPriceKrw: Math.min(...prices),
      maxPriceKrw: Math.max(...prices),
      txCount: prices.length,
    } satisfies MonthlyAggregate;
  });
};

export const upsertMonthlyAggregates = async (aggregates: MonthlyAggregate[]): Promise<void> => {
  if (aggregates.length === 0) return;

  const bucket = new Map<string, MonthlyAggregate[]>();

  for (const item of aggregates) {
    const id = `${item.region}|${item.districtCode}|${item.yearMonth}`;
    const list = bucket.get(id) ?? [];
    list.push(item);
    bucket.set(id, list);
  }

  const batch = firestore.batch();

  for (const [id, items] of bucket.entries()) {
    const first = items[0];
    const doc: MonthlyAggregateGroupDocument = {
      id,
      region: first.region,
      districtCode: first.districtCode,
      yearMonth: first.yearMonth,
      items,
      totalTxCount: items.reduce((acc, item) => acc + item.txCount, 0),
    };

    batch.set(monthlyGroupCollection.doc(id), doc, { merge: true });
  }

  await batch.commit();
};
