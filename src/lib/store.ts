import { firestore } from "./firebase.js";
import { MonthlyAggregate, TradeRecord } from "./types.js";

const tradesCollection = firestore.collection("apt_transactions");
const monthlyCollection = firestore.collection("apt_monthly_aggregates");

export const upsertTrades = async (records: TradeRecord[]): Promise<void> => {
  if (records.length === 0) return;

  const batch = firestore.batch();

  for (const record of records) {
    const ref = tradesCollection.doc(record.id);
    batch.set(ref, record, { merge: true });
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

  const batch = firestore.batch();

  for (const item of aggregates) {
    const id = `${item.region}|${item.districtCode}|${item.apartmentName}|${item.yearMonth}`;
    batch.set(monthlyCollection.doc(id), item, { merge: true });
  }

  await batch.commit();
};
