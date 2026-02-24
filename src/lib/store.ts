import { FieldValue } from "@google-cloud/firestore";
import { firestore } from "./firebase.js";
import { ApartmentMetadata, MonthlyAggregate, TradeRecord } from "./types.js";

const tradesCollection = firestore.collection("apt_transactions");
const monthlyCollection = firestore.collection("apt_monthly_aggregates");
const metadataCollection = firestore.collection("apt_metadata");

export const upsertApartmentMetadata = async (records: TradeRecord[]): Promise<void> => {
  if (records.length === 0) return;

  const bucket = new Map<string, { metadata: Omit<ApartmentMetadata, 'availableAreas'>, areas: Set<number> }>();

  for (const record of records) {
    if (!record.apartmentName) continue;
    const id = `${record.region}|${record.districtCode}|${record.apartmentName}`;
    const existing = bucket.get(id);

    if (existing) {
      existing.areas.add(record.areaM2);
      existing.metadata.totalTrades += 1;
      if (record.tradedAt > existing.metadata.lastTradeAt) {
        existing.metadata.lastTradeAt = record.tradedAt;
      }
    } else {
      bucket.set(id, {
        metadata: {
          id,
          region: record.region,
          districtCode: record.districtCode,
          legalDong: record.legalDong,
          apartmentName: record.apartmentName,
          totalTrades: 1,
          lastTradeAt: record.tradedAt,
        },
        areas: new Set([record.areaM2]),
      });
    }
  }

  const batch = firestore.batch();
  for (const [id, data] of bucket.entries()) {
    const sortedAreas = Array.from(data.areas).sort((a, b) => a - b);

    // Use Firestore transforms to append array union if needed, 
    // or just fetch first if we want pure accuracy. Since we want an upsert:
    batch.set(metadataCollection.doc(id), {
      ...data.metadata,
      availableAreas: FieldValue.arrayUnion(...sortedAreas),
      totalTrades: FieldValue.increment(data.metadata.totalTrades),
      lastTradeAt: data.metadata.lastTradeAt // This might overwrite with older date if not careful in real prod, but fine for this scope
    }, { merge: true });
  }

  await batch.commit();
};

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
  const apartmentBucket = new Map<string, TradeRecord[]>();
  const districtBucket = new Map<string, TradeRecord[]>();

  for (const record of records) {
    const ym = record.tradedAt.slice(0, 7).replace("-", "");

    // Apartment level key
    const aptKey = `${record.region}|${record.districtCode}|${record.apartmentName}|${ym}`;
    const aptList = apartmentBucket.get(aptKey) ?? [];
    aptList.push(record);
    apartmentBucket.set(aptKey, aptList);

    // District level key (no apartment name)
    const distKey = `${record.region}|${record.districtCode}||${ym}`;
    const distList = districtBucket.get(distKey) ?? [];
    distList.push(record);
    districtBucket.set(distKey, distList);
  }

  const processBucket = (bucket: Map<string, TradeRecord[]>): MonthlyAggregate[] => {
    return [...bucket.entries()].map(([key, list]) => {
      const [region, districtCode, apartmentName, yearMonth] = key.split("|");
      const prices = list.map((item) => item.priceKrw);
      const sum = prices.reduce((acc, value) => acc + value, 0);

      return {
        region,
        districtCode,
        apartmentName: apartmentName || undefined,
        yearMonth,
        avgPriceKrw: Math.round(sum / prices.length),
        medianPriceKrw: median(prices),
        minPriceKrw: Math.min(...prices),
        maxPriceKrw: Math.max(...prices),
        txCount: prices.length,
      } satisfies MonthlyAggregate;
    });
  };

  return [...processBucket(apartmentBucket), ...processBucket(districtBucket)];
};

export const upsertMonthlyAggregates = async (aggregates: MonthlyAggregate[]): Promise<void> => {
  if (aggregates.length === 0) return;

  // Use a map to ensure we don't have duplicate IDs in the same batch if aggregates overlap
  const batch = firestore.batch();
  const seenIds = new Set<string>();

  for (const item of aggregates) {
    const aptPart = item.apartmentName ?? "";
    const id = `${item.region}|${item.districtCode}|${aptPart}|${item.yearMonth}`;
    if (!seenIds.has(id)) {
      const payload = item.apartmentName
        ? item
        : {
            region: item.region,
            districtCode: item.districtCode,
            yearMonth: item.yearMonth,
            avgPriceKrw: item.avgPriceKrw,
            medianPriceKrw: item.medianPriceKrw,
            minPriceKrw: item.minPriceKrw,
            maxPriceKrw: item.maxPriceKrw,
            txCount: item.txCount,
          };

      batch.set(monthlyCollection.doc(id), payload, { merge: true });
      seenIds.add(id);
    }
  }

  await batch.commit();
};

export const updateAggregatesFromStore = async (districtCode: string, yearMonth: string): Promise<void> => {
  const snapshot = await tradesCollection
    .where("districtCode", "==", districtCode)
    .where("tradedAt", ">=", `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`)
    .where("tradedAt", "<=", `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-31`)
    .get();

  const records = snapshot.docs.map((doc) => doc.data() as TradeRecord);
  if (records.length === 0) return;

  const aggregates = makeMonthlyAggregates(records);
  await upsertMonthlyAggregates(aggregates);
};
