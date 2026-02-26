import { ApartmentMetadata, MonthlyAggregate, RentRecord, TradeRecord } from "./types.js";
import { ensureOracleSchema } from "./schema.js";
import { withOracleConnection } from "./oracle.js";

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

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

    const aptKey = `${record.region}|${record.districtCode}|${record.apartmentName}|${ym}`;
    const aptList = apartmentBucket.get(aptKey) ?? [];
    aptList.push(record);
    apartmentBucket.set(aptKey, aptList);

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

export const makeMonthlyRentAggregates = (records: RentRecord[]): Array<MonthlyAggregate & { rentType: "JEONSE" | "WOLSE" }> => {
  const apartmentBucket = new Map<string, Array<RentRecord>>();
  const districtBucket = new Map<string, Array<RentRecord>>();

  for (const record of records) {
    const ym = record.contractedAt.slice(0, 7).replace("-", "");

    const aptKey = `${record.region}|${record.districtCode}|${record.apartmentName}|${ym}|${record.rentType}`;
    const aptList = apartmentBucket.get(aptKey) ?? [];
    aptList.push(record);
    apartmentBucket.set(aptKey, aptList);

    const distKey = `${record.region}|${record.districtCode}||${ym}|${record.rentType}`;
    const distList = districtBucket.get(distKey) ?? [];
    distList.push(record);
    districtBucket.set(distKey, distList);
  }

  const processBucket = (bucket: Map<string, Array<RentRecord>>): Array<MonthlyAggregate & { rentType: "JEONSE" | "WOLSE" }> => {
    return [...bucket.entries()].map(([key, list]) => {
      const [region, districtCode, apartmentName, yearMonth, rentTypeStr] = key.split("|");
      const rentType = rentTypeStr as "JEONSE" | "WOLSE";

      const prices = list.map((item) => (rentType === "JEONSE" ? item.depositKrw : item.monthlyRentKrw));
      const sum = prices.reduce((acc, value) => acc + value, 0);

      const depositPrices = list.map((item) => item.depositKrw);
      const depositSum = depositPrices.reduce((acc, value) => acc + value, 0);

      // We reuse MonthlyAggregate interface shape and overwrite priceKrw with the primary rent metric
      // but also add rentType and maybe we need a custom shape eventually?
      // Since re_rent_monthly_aggregates in schema uses avg_deposit_krw, avg_monthly_rent_krw
      // Wait, let's keep it aligned with the shape expected.
      return {
        region,
        districtCode,
        apartmentName: apartmentName || undefined,
        yearMonth,
        rentType,
        avgPriceKrw: Math.round(depositSum / depositPrices.length), // deposit avg
        medianPriceKrw: median(depositPrices),
        minPriceKrw: rentType === "WOLSE" ? Math.round(sum / prices.length) : 0, // storing avg monthly rent here for wolse
        maxPriceKrw: 0,
        txCount: prices.length,
      } as MonthlyAggregate & { rentType: "JEONSE" | "WOLSE" };
    });
  };

  return [...processBucket(apartmentBucket), ...processBucket(districtBucket)];
};

export const upsertTrades = async (records: TradeRecord[]): Promise<void> => {
  if (records.length === 0) return;
  await ensureOracleSchema();

  await withOracleConnection(async (connection) => {
    const sql = `
      MERGE INTO re_sale_transactions t
      USING (
        SELECT
          :id AS id,
          :region AS region,
          :district_code AS district_code,
          :legal_dong AS legal_dong,
          :apartment_name AS apartment_name,
          :area_m2 AS area_m2,
          :price_krw AS price_krw,
          :floor AS floor,
          :traded_at AS traded_at,
          :source AS source,
          :collected_at AS collected_at
        FROM dual
      ) s
      ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET
        t.region = s.region,
        t.district_code = s.district_code,
        t.legal_dong = s.legal_dong,
        t.apartment_name = s.apartment_name,
        t.area_m2 = s.area_m2,
        t.price_krw = s.price_krw,
        t.floor = s.floor,
        t.traded_at = s.traded_at,
        t.source = s.source,
        t.collected_at = s.collected_at
      WHEN NOT MATCHED THEN INSERT (
        id, region, district_code, legal_dong, apartment_name,
        area_m2, price_krw, floor, traded_at, source, collected_at
      ) VALUES (
        s.id, s.region, s.district_code, s.legal_dong, s.apartment_name,
        s.area_m2, s.price_krw, s.floor, s.traded_at, s.source, s.collected_at
      )
    `;

    await connection.executeMany(
      sql,
      records.map((record) => ({
        id: record.id,
        region: record.region,
        district_code: record.districtCode,
        legal_dong: record.legalDong,
        apartment_name: record.apartmentName,
        area_m2: record.areaM2,
        price_krw: record.priceKrw,
        floor: record.floor,
        traded_at: toDate(record.tradedAt),
        source: record.source,
        collected_at: new Date(record.collectedAt),
      })),
      { autoCommit: true },
    );
  });
};

export const upsertApartmentMetadata = async (records: TradeRecord[]): Promise<void> => {
  if (records.length === 0) return;
  await ensureOracleSchema();

  const bucket = new Map<string, { metadata: Omit<ApartmentMetadata, "availableAreas">; areas: Set<number> }>();

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

  await withOracleConnection(async (connection) => {
    const metadataSql = `
      MERGE INTO re_apartment_metadata m
      USING (
        SELECT
          :id AS id,
          :region AS region,
          :district_code AS district_code,
          :legal_dong AS legal_dong,
          :apartment_name AS apartment_name,
          :trade_count AS trade_count,
          :last_trade_at AS last_trade_at
        FROM dual
      ) s
      ON (m.id = s.id)
      WHEN MATCHED THEN UPDATE SET
        m.region = s.region,
        m.district_code = s.district_code,
        m.legal_dong = s.legal_dong,
        m.apartment_name = s.apartment_name,
        m.total_sale_trades = m.total_sale_trades + s.trade_count,
        m.last_sale_traded_at = GREATEST(m.last_sale_traded_at, s.last_trade_at)
      WHEN NOT MATCHED THEN INSERT (
        id, region, district_code, legal_dong, apartment_name,
        total_sale_trades, last_sale_traded_at
      ) VALUES (
        s.id, s.region, s.district_code, s.legal_dong, s.apartment_name,
        s.trade_count, s.last_trade_at
      )
    `;

    const areaSql = `
      INSERT /*+ IGNORE_ROW_ON_DUPKEY_INDEX(re_apartment_areas (metadata_id, area_m2)) */
      INTO re_apartment_areas (metadata_id, area_m2)
      VALUES (:metadata_id, :area_m2)
    `;

    const entries = [...bucket.values()];

    await connection.executeMany(
      metadataSql,
      entries.map((entry) => ({
        id: entry.metadata.id,
        region: entry.metadata.region,
        district_code: entry.metadata.districtCode,
        legal_dong: entry.metadata.legalDong,
        apartment_name: entry.metadata.apartmentName,
        trade_count: entry.metadata.totalTrades,
        last_trade_at: toDate(entry.metadata.lastTradeAt),
      })),
      { autoCommit: false },
    );

    // De-dupe in-memory to avoid ORA-00001 unique constraint violations
    // if the same (metadata_id, area_m2) shows up multiple times in a run.
    const areaBinds = (() => {
      const seen = new Set<string>();
      const out: Array<{ metadata_id: string; area_m2: number }> = [];

      for (const entry of entries) {
        for (const area of entry.areas) {
          const key = `${entry.metadata.id}|${area}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ metadata_id: entry.metadata.id, area_m2: area });
        }
      }

      return out;
    })();

    if (areaBinds.length > 0) {
      // Prevent ORA-00001 when the same (metadata_id, area_m2) appears more than once
      // in a single batch (can happen across repeated ingests).
      await connection.executeMany(areaSql, areaBinds, { autoCommit: false });
    }

    await connection.commit();
  });
};

export const upsertMonthlyAggregates = async (aggregates: MonthlyAggregate[]): Promise<void> => {
  if (aggregates.length === 0) return;
  await ensureOracleSchema();

  const uniqueById = new Map<string, MonthlyAggregate>();
  for (const item of aggregates) {
    const aptPart = item.apartmentName ?? "";
    const id = `${item.region}|${item.districtCode}|${aptPart}|${item.yearMonth}`;
    if (!uniqueById.has(id)) {
      uniqueById.set(id, item);
    }
  }

  await withOracleConnection(async (connection) => {
    const sql = `
      MERGE INTO re_sale_monthly_aggregates t
      USING (
        SELECT
          :id AS id,
          :region AS region,
          :district_code AS district_code,
          :apartment_name AS apartment_name,
          :year_month AS year_month,
          :avg_price_krw AS avg_price_krw,
          :median_price_krw AS median_price_krw,
          :min_price_krw AS min_price_krw,
          :max_price_krw AS max_price_krw,
          :tx_count AS tx_count
        FROM dual
      ) s
      ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET
        t.region = s.region,
        t.district_code = s.district_code,
        t.apartment_name = s.apartment_name,
        t.year_month = s.year_month,
        t.avg_price_krw = s.avg_price_krw,
        t.median_price_krw = s.median_price_krw,
        t.min_price_krw = s.min_price_krw,
        t.max_price_krw = s.max_price_krw,
        t.tx_count = s.tx_count,
        t.updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        id, region, district_code, apartment_name, year_month,
        avg_price_krw, median_price_krw, min_price_krw, max_price_krw, tx_count
      ) VALUES (
        s.id, s.region, s.district_code, s.apartment_name, s.year_month,
        s.avg_price_krw, s.median_price_krw, s.min_price_krw, s.max_price_krw, s.tx_count
      )
    `;

    await connection.executeMany(
      sql,
      [...uniqueById.entries()].map(([id, item]) => ({
        id,
        region: item.region,
        district_code: item.districtCode,
        apartment_name: item.apartmentName ?? null,
        year_month: item.yearMonth,
        avg_price_krw: item.avgPriceKrw,
        median_price_krw: item.medianPriceKrw,
        min_price_krw: item.minPriceKrw,
        max_price_krw: item.maxPriceKrw,
        tx_count: item.txCount,
      })),
      { autoCommit: true },
    );
  });
};

export const updateAggregatesFromStore = async (districtCode: string, yearMonth: string): Promise<void> => {
  await ensureOracleSchema();
  const fromDate = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;
  const toDateString = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-31`;

  const records = await withOracleConnection(async (connection) => {
    const result = await connection.execute(
      `
      SELECT
        id,
        region,
        district_code,
        legal_dong,
        apartment_name,
        area_m2,
        price_krw,
        floor,
        TO_CHAR(traded_at, 'YYYY-MM-DD') AS traded_at,
        source,
        TO_CHAR(collected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS collected_at
      FROM re_sale_transactions
      WHERE district_code = :district_code
        AND traded_at BETWEEN TO_DATE(:from_date, 'YYYY-MM-DD') AND TO_DATE(:to_date, 'YYYY-MM-DD')
      `,
      {
        district_code: districtCode,
        from_date: fromDate,
        to_date: toDateString,
      },
    );

    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.ID),
      region: String(row.REGION),
      districtCode: String(row.DISTRICT_CODE),
      legalDong: String(row.LEGAL_DONG),
      apartmentName: String(row.APARTMENT_NAME),
      areaM2: Number(row.AREA_M2),
      priceKrw: Number(row.PRICE_KRW),
      floor: Number(row.FLOOR),
      tradedAt: String(row.TRADED_AT),
      source: "MOLIT_RTMS",
      collectedAt: String(row.COLLECTED_AT),
    } satisfies TradeRecord));
  });

  if (records.length === 0) return;

  const aggregates = makeMonthlyAggregates(records);
  await upsertMonthlyAggregates(aggregates);
};

export const upsertMonthlyRentAggregates = async (aggregates: Array<MonthlyAggregate & { rentType: "JEONSE" | "WOLSE" }>): Promise<void> => {
  if (aggregates.length === 0) return;
  await ensureOracleSchema();

  const uniqueById = new Map<string, MonthlyAggregate & { rentType: "JEONSE" | "WOLSE" }>();
  for (const item of aggregates) {
    const aptPart = item.apartmentName ?? "";
    const id = `${item.region}|${item.districtCode}|${aptPart}|${item.yearMonth}|${item.rentType}`;
    if (!uniqueById.has(id)) {
      uniqueById.set(id, item);
    }
  }

  await withOracleConnection(async (connection) => {
    const sql = `
      MERGE INTO re_rent_monthly_aggregates t
      USING (
        SELECT
          :id AS id,
          :region AS region,
          :district_code AS district_code,
          :apartment_name AS apartment_name,
          :rent_type AS rent_type,
          :year_month AS year_month,
          :avg_deposit_krw AS avg_deposit_krw,
          :avg_monthly_rent_krw AS avg_monthly_rent_krw,
          :tx_count AS tx_count
        FROM dual
      ) s
      ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET
        t.region = s.region,
        t.district_code = s.district_code,
        t.apartment_name = s.apartment_name,
        t.rent_type = s.rent_type,
        t.year_month = s.year_month,
        t.avg_deposit_krw = s.avg_deposit_krw,
        t.avg_monthly_rent_krw = s.avg_monthly_rent_krw,
        t.tx_count = s.tx_count,
        t.updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        id, region, district_code, apartment_name, rent_type, year_month,
        avg_deposit_krw, avg_monthly_rent_krw, tx_count
      ) VALUES (
        s.id, s.region, s.district_code, s.apartment_name, s.rent_type, s.year_month,
        s.avg_deposit_krw, s.avg_monthly_rent_krw, s.tx_count
      )
    `;

    await connection.executeMany(
      sql,
      [...uniqueById.entries()].map(([id, item]) => ({
        id,
        region: item.region,
        district_code: item.districtCode,
        apartment_name: item.apartmentName ?? null,
        rent_type: item.rentType,
        year_month: item.yearMonth,
        avg_deposit_krw: item.avgPriceKrw,
        avg_monthly_rent_krw: item.minPriceKrw, // minPriceKrw maps to avg_monthly_rent from our make logic above
        tx_count: item.txCount,
      })),
      { autoCommit: true },
    );
  });
};

export const searchApartmentMetadata = async (input: {
  districtCode: string;
  legalDong?: string;
  nameContains?: string;
  limit?: number;
}): Promise<Array<{ legalDong: string; apartmentName: string; availableAreas: number[]; totalTrades: number }>> => {
  await ensureOracleSchema();
  const limitValue = input.limit ?? 100;

  return await withOracleConnection(async (connection) => {
    const result = await connection.execute(
      `
      SELECT
        m.legal_dong,
        m.apartment_name,
        m.total_sale_trades,
        LISTAGG(TO_CHAR(a.area_m2), ',') WITHIN GROUP (ORDER BY a.area_m2) AS area_list
      FROM re_apartment_metadata m
      LEFT JOIN re_apartment_areas a ON a.metadata_id = m.id
      WHERE m.district_code = :district_code
        AND (:name_contains IS NULL OR REPLACE(m.apartment_name, ' ', '') LIKE '%' || REPLACE(:name_contains, ' ', '') || '%')
        AND (:legal_dong IS NULL OR m.legal_dong = :legal_dong)
      GROUP BY m.legal_dong, m.apartment_name, m.total_sale_trades
      ORDER BY m.total_sale_trades DESC, m.apartment_name ASC
      FETCH FIRST ${Math.max(1, Math.min(1000, limitValue))} ROWS ONLY
      `,
      {
        district_code: input.districtCode,
        name_contains: input.nameContains ?? null,
        legal_dong: input.legalDong ?? null,
      },
    );

    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      legalDong: String(row.LEGAL_DONG),
      apartmentName: String(row.APARTMENT_NAME),
      availableAreas: String(row.AREA_LIST ?? "")
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
      totalTrades: Number(row.TOTAL_SALE_TRADES),
    }));
  });
};

export const searchSaleMonthlyTrends = async (input: {
  region?: string;
  districtCode?: string;
  apartmentName?: string;
  fromYm: string;
  toYm: string;
  limit: number;
}): Promise<Array<Record<string, unknown>>> => {
  await ensureOracleSchema();

  const conditions = ["year_month >= :from_ym", "year_month <= :to_ym"];
  const binds: Record<string, unknown> = {
    from_ym: input.fromYm,
    to_ym: input.toYm,
  };

  if (input.region) {
    conditions.push("region = :region");
    binds.region = input.region;
  }

  if (input.districtCode) {
    conditions.push("district_code = :district_code");
    binds.district_code = input.districtCode;
  }

  if (input.apartmentName) {
    conditions.push("apartment_name = :apartment_name");
    binds.apartment_name = input.apartmentName;
  } else {
    conditions.push("apartment_name IS NULL");
  }

  return await withOracleConnection(async (connection) => {
    const result = await connection.execute(
      `
      SELECT
        year_month,
        region,
        district_code,
        apartment_name,
        avg_price_krw,
        median_price_krw,
        min_price_krw,
        max_price_krw,
        tx_count
      FROM re_sale_monthly_aggregates
      WHERE ${conditions.join(" AND ")}
      ORDER BY year_month ASC
      FETCH FIRST ${Math.max(1, Math.min(240, input.limit))} ROWS ONLY
      `,
      binds,
    );

    return (result.rows ?? []) as Array<Record<string, unknown>>;
  });
};

export const getLatestSaleTransactions = async (input: {
  region?: string;
  districtCode?: string;
  legalDong?: string;
  apartmentName?: string;
  areaM2?: number;
  limit: number;
}): Promise<Array<Record<string, unknown>>> => {
  await ensureOracleSchema();

  const conditions: string[] = [];
  const binds: Record<string, unknown> = {};

  if (input.region) {
    conditions.push("region = :region");
    binds.region = input.region;
  }

  if (input.districtCode) {
    conditions.push("district_code = :district_code");
    binds.district_code = input.districtCode;
  }

  if (input.legalDong) {
    conditions.push("legal_dong = :legal_dong");
    binds.legal_dong = input.legalDong;
  }

  if (input.apartmentName) {
    conditions.push("apartment_name = :apartment_name");
    binds.apartment_name = input.apartmentName;
  }

  if (typeof input.areaM2 === "number") {
    conditions.push("TRUNC(area_m2) = TRUNC(:area_m2)");
    binds.area_m2 = input.areaM2;
  }

  return await withOracleConnection(async (connection) => {
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await connection.execute(
      `
      SELECT
        TO_CHAR(traded_at, 'YYYY-MM-DD') AS traded_at,
        region,
        legal_dong,
        apartment_name,
        area_m2,
        floor,
        price_krw
      FROM re_sale_transactions
      ${whereClause}
      ORDER BY traded_at DESC
      FETCH FIRST ${Math.max(1, Math.min(30, input.limit))} ROWS ONLY
      `,
      binds,
    );

    return (result.rows ?? []) as Array<Record<string, unknown>>;
  });
};

export const getLatestRentTransactions = async (input: {
  region?: string;
  districtCode?: string;
  legalDong?: string;
  apartmentName?: string;
  areaM2?: number;
  rentType?: "JEONSE" | "WOLSE";
  limit: number;
}): Promise<Array<Record<string, unknown>>> => {
  await ensureOracleSchema();

  const conditions: string[] = [];
  const binds: Record<string, unknown> = {};

  if (input.region) {
    conditions.push("region = :region");
    binds.region = input.region;
  }

  if (input.districtCode) {
    conditions.push("district_code = :district_code");
    binds.district_code = input.districtCode;
  }

  if (input.legalDong) {
    conditions.push("legal_dong = :legal_dong");
    binds.legal_dong = input.legalDong;
  }

  if (input.apartmentName) {
    conditions.push("apartment_name = :apartment_name");
    binds.apartment_name = input.apartmentName;
  }

  if (typeof input.areaM2 === "number") {
    conditions.push("TRUNC(area_m2) = TRUNC(:area_m2)");
    binds.area_m2 = input.areaM2;
  }

  if (input.rentType) {
    conditions.push("rent_type = :rent_type");
    binds.rent_type = input.rentType;
  }

  return await withOracleConnection(async (connection) => {
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await connection.execute(
      `
      SELECT
        TO_CHAR(contracted_at, 'YYYY-MM-DD') AS contracted_at,
        region,
        legal_dong,
        apartment_name,
        area_m2,
        floor,
        rent_type,
        deposit_krw,
        monthly_rent_krw
      FROM re_rent_transactions
      ${whereClause}
      ORDER BY contracted_at DESC
      FETCH FIRST ${Math.max(1, Math.min(30, input.limit))} ROWS ONLY
      `,
      binds,
    );

    return (result.rows ?? []) as Array<Record<string, unknown>>;
  });
};

export const upsertRentTransactions = async (records: RentRecord[]): Promise<void> => {
  if (records.length === 0) return;
  await ensureOracleSchema();

  await withOracleConnection(async (connection) => {
    const sql = `
      MERGE INTO re_rent_transactions t
      USING (
        SELECT
          :id AS id,
          :region AS region,
          :district_code AS district_code,
          :legal_dong AS legal_dong,
          :apartment_name AS apartment_name,
          :area_m2 AS area_m2,
          :rent_type AS rent_type,
          :deposit_krw AS deposit_krw,
          :monthly_rent_krw AS monthly_rent_krw,
          :floor AS floor,
          :contracted_at AS contracted_at,
          :source AS source,
          :collected_at AS collected_at
        FROM dual
      ) s
      ON (t.id = s.id)
      WHEN MATCHED THEN UPDATE SET
        t.region = s.region,
        t.district_code = s.district_code,
        t.legal_dong = s.legal_dong,
        t.apartment_name = s.apartment_name,
        t.area_m2 = s.area_m2,
        t.rent_type = s.rent_type,
        t.deposit_krw = s.deposit_krw,
        t.monthly_rent_krw = s.monthly_rent_krw,
        t.floor = s.floor,
        t.contracted_at = s.contracted_at,
        t.source = s.source,
        t.collected_at = s.collected_at
      WHEN NOT MATCHED THEN INSERT (
        id, region, district_code, legal_dong, apartment_name, area_m2,
        rent_type, deposit_krw, monthly_rent_krw, floor, contracted_at, source, collected_at
      ) VALUES (
        s.id, s.region, s.district_code, s.legal_dong, s.apartment_name, s.area_m2,
        s.rent_type, s.deposit_krw, s.monthly_rent_krw, s.floor, s.contracted_at, s.source, s.collected_at
      )
    `;

    await connection.executeMany(
      sql,
      records.map((record) => ({
        id: record.id,
        region: record.region,
        district_code: record.districtCode,
        legal_dong: record.legalDong,
        apartment_name: record.apartmentName,
        area_m2: record.areaM2,
        rent_type: record.rentType,
        deposit_krw: record.depositKrw,
        monthly_rent_krw: record.monthlyRentKrw,
        floor: record.floor,
        contracted_at: toDate(record.contractedAt),
        source: record.source,
        collected_at: new Date(record.collectedAt),
      })),
      { autoCommit: true },
    );
  });
};

export const executeSelectQuery = async (query: string): Promise<Array<Record<string, unknown>>> => {
  await ensureOracleSchema();

  const upperQuery = query.trim().toUpperCase();
  if (!upperQuery.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed for safety.");
  }

  const forbiddenKeywords = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "GRANT", "REVOKE", "MERGE", "CALL", "BEGIN", "COMMIT", "ROLLBACK"];
  for (const keyword of forbiddenKeywords) {
    // Basic check for word boundaries to avoid accidentally catching inside column names, 
    // though strict enough for an LLM-facing tool.
    if (new RegExp(`\\b${keyword}\\b`).test(upperQuery)) {
      throw new Error(`Query contains forbidden keyword: ${keyword}. Only SELECTs are allowed.`);
    }
  }

  return await withOracleConnection(async (connection) => {
    // For safety and performance, enforce a max limit at DB level since LLMs might forget
    const safeQuery = `
      SELECT * FROM (
        ${query}
      )
      FETCH FIRST 100 ROWS ONLY
    `;
    const result = await connection.execute(safeQuery);
    return (result.rows ?? []) as Array<Record<string, unknown>>;
  });
};


