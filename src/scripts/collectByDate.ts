import { collectTradesByMonth, collectRentByMonth } from "../collector/molitCollector.js";
import { seoulMetroDistricts } from "../lib/config.js";
import { makeMonthlyAggregates, upsertMonthlyAggregates, upsertTrades, upsertApartmentMetadata, upsertRentTransactions, upsertMonthlyRentAggregates, makeMonthlyRentAggregates, upsertApartmentMetadataFromRents } from "../lib/store.js";

type Mode = "bootstrap" | "incremental";

type CliArgs = {
  mode: Mode;
  from: string;
  to: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseArgValue = (args: string[], key: string): string | undefined => {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  return args[index + 1];
};

const assertValidDate = (value: string, key: string): void => {
  if (!DATE_RE.test(value)) {
    throw new Error(`${key} must be YYYY-MM-DD format. received=${value}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${key} is not a valid date. received=${value}`);
  }
};

const normalizeToYm = (date: string): string => date.slice(0, 7).replace("-", "");

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

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
};

const parseCliArgs = (args: string[]): CliArgs => {
  const modeRaw = parseArgValue(args, "--mode") ?? "incremental";
  if (modeRaw !== "bootstrap" && modeRaw !== "incremental") {
    throw new Error("--mode must be one of: bootstrap | incremental");
  }

  const from = parseArgValue(args, "--from");

  if (!from) {
    throw new Error("--from is required. example: --from 2024-01-01");
  }

  assertValidDate(from, "--from");

  if (modeRaw === "bootstrap") {
    const to = parseArgValue(args, "--to");
    if (!to) {
      throw new Error("bootstrap mode requires --to. example: --to 2024-12-31");
    }
    assertValidDate(to, "--to");

    if (from > to) {
      throw new Error("--from must be less than or equal to --to");
    }

    return { mode: modeRaw, from, to };
  }

  const to = parseArgValue(args, "--to") ?? from;
  assertValidDate(to, "--to");

  if (from > to) {
    throw new Error("--from must be less than or equal to --to");
  }

  return {
    mode: modeRaw,
    from,
    to,
  };
};

const main = async (): Promise<void> => {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const startYm = normalizeToYm(cliArgs.from);
  const endYm = normalizeToYm(cliArgs.to);
  const months = getYearMonths(startYm, endYm);

  console.log(`[START] mode=${cliArgs.mode} from=${cliArgs.from} to=${cliArgs.to} months=${months.join(",")}`);

  for (const district of seoulMetroDistricts) {
    for (const ym of months) {
      try {
        console.log(`[STEP] fetch:start ${district.region}/${district.lawdCd}/${ym}`);
        const trades = await withTimeout(
          collectTradesByMonth(district.lawdCd, ym, district.region),
          30_000,
          `collectTradesByMonth ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] fetch:done ${district.region}/${district.lawdCd}/${ym} trades=${trades.length}`);

        console.log(`[STEP] upsertTrades:start ${district.region}/${district.lawdCd}/${ym}`);
        await withTimeout(
          upsertTrades(trades),
          60_000,
          `upsertTrades ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertTrades:done ${district.region}/${district.lawdCd}/${ym}`);

        const aggregates = makeMonthlyAggregates(trades);
        console.log(`[STEP] upsertMonthly:start ${district.region}/${district.lawdCd}/${ym} aggregates=${aggregates.length}`);
        await withTimeout(
          upsertMonthlyAggregates(aggregates),
          60_000,
          `upsertMonthlyAggregates ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertMonthly:done ${district.region}/${district.lawdCd}/${ym}`);

        console.log(`[STEP] upsertMetadata:start ${district.region}/${district.lawdCd}/${ym}`);
        await withTimeout(
          upsertApartmentMetadata(trades),
          60_000,
          `upsertApartmentMetadata ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertMetadata:done ${district.region}/${district.lawdCd}/${ym}`);

        console.log(`[STEP] fetch_rent:start ${district.region}/${district.lawdCd}/${ym}`);
        const rents = await withTimeout(
          collectRentByMonth(district.lawdCd, ym, district.region),
          30_000,
          `collectRentByMonth ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] fetch_rent:done ${district.region}/${district.lawdCd}/${ym} rents=${rents.length}`);

        console.log(`[STEP] upsertRent:start ${district.region}/${district.lawdCd}/${ym}`);
        await withTimeout(
          upsertRentTransactions(rents),
          60_000,
          `upsertRentTransactions ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertRent:done ${district.region}/${district.lawdCd}/${ym}`);

        const rentAggregates = makeMonthlyRentAggregates(rents);
        console.log(`[STEP] upsertMonthlyRent:start ${district.region}/${district.lawdCd}/${ym} aggregates=${rentAggregates.length}`);
        await withTimeout(
          upsertMonthlyRentAggregates(rentAggregates),
          60_000,
          `upsertMonthlyRentAggregates ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertMonthlyRent:done ${district.region}/${district.lawdCd}/${ym}`);

        console.log(`[STEP] upsertMetadataFromRent:start ${district.region}/${district.lawdCd}/${ym}`);
        await withTimeout(
          upsertApartmentMetadataFromRents(rents),
          60_000,
          `upsertApartmentMetadataFromRents ${district.region}/${district.lawdCd}/${ym}`,
        );
        console.log(`[STEP] upsertMetadataFromRent:done ${district.region}/${district.lawdCd}/${ym}`);

        console.log(
          `[INGEST] mode=${cliArgs.mode} ${district.region}/${district.lawdCd}/${ym}: trades=${trades.length}, monthlyAgg=${aggregates.length}, rents=${rents.length}, rentAgg=${rentAggregates.length}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[INGEST_ERROR] mode=${cliArgs.mode} ${district.region}/${district.lawdCd}/${ym}: ${message}`);
      }
    }
  }

  console.log("[DONE] collectByDate completed");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
