import { collectTradesByMonth, collectRentByMonth } from "../collector/molitCollector.js";
import { seoulMetroDistricts } from "../lib/config.js";
import { makeMonthlyAggregates, upsertMonthlyAggregates, upsertTrades, upsertApartmentMetadata, upsertRentTransactions, upsertMonthlyRentAggregates, makeMonthlyRentAggregates } from "../lib/store.js";

const getYearMonths = (startYm: string, endYm: string): string[] => {
  const out: string[] = [];
  let year = Number(startYm.slice(0, 4));
  let month = Number(startYm.slice(4, 6));
  const endYear = Number(endYm.slice(0, 4));
  const endMonth = Number(endYm.slice(4, 6));

  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return out;
};

const main = async (): Promise<void> => {
  const startYm = process.argv[2] ?? "202401";
  const endYm = process.argv[3] ?? startYm;
  const months = getYearMonths(startYm, endYm);

  for (const district of seoulMetroDistricts) {
    for (const ym of months) {
      const trades = await collectTradesByMonth(district.lawdCd, ym, district.region);
      await upsertTrades(trades);
      const aggregates = makeMonthlyAggregates(trades);
      await upsertMonthlyAggregates(aggregates);
      await upsertApartmentMetadata(trades);

      const rents = await collectRentByMonth(district.lawdCd, ym, district.region);
      await upsertRentTransactions(rents);
      const rentAggregates = makeMonthlyRentAggregates(rents);
      await upsertMonthlyRentAggregates(rentAggregates);

      console.log(
        `[INGEST] ${district.region}/${district.lawdCd}/${ym}: trades=${trades.length}, monthlyAgg=${aggregates.length}, rents=${rents.length}, rentAgg=${rentAggregates.length}`,
      );
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
