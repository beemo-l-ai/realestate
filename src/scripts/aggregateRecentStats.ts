import { withOracleConnection } from "../lib/oracle.js";
import { upsertRecentAreaStats } from "../lib/store.js";
import { ensureOracleSchema } from "../lib/schema.js";

const main = async (): Promise<void> => {
  await ensureOracleSchema();
  const lookbackDays = 90;

  await withOracleConnection(async (connection) => {
    console.log(`[AGGREGATE] Starting 1-month average calculation (lookback: ${lookbackDays} days)...`);

    // Find the max date from both tables to use as the base date instead of SYSDATE
    const maxDateResult = await connection.execute(`
      SELECT MAX(latest_dt) as max_dt FROM (
        SELECT MAX(traded_at) as latest_dt FROM re_sale_transactions
        UNION ALL
        SELECT MAX(contracted_at) as latest_dt FROM re_rent_transactions
      )
    `);
    
    // Fallback to SYSDATE if there's no data
    const maxDate = (maxDateResult.rows?.[0] as any)?.MAX_DT;
    const baseDateExp = maxDate ? `TO_DATE('${maxDate.toISOString().slice(0,10)}', 'YYYY-MM-DD')` : `SYSDATE`;

    console.log(`[AGGREGATE] Base date for calculation: ${maxDate ? maxDate.toISOString().slice(0,10) : 'SYSDATE'}`);

    // 1. Sales Aggregation
    const saleResult = await connection.execute(`
      SELECT 
        region, district_code, legal_dong, apartment_name, 
        TRUNC(area_m2) as area_group,
        ROUND(AVG(price_krw)) as avg_price,
        COUNT(*) as tx_count
      FROM re_sale_transactions
      WHERE traded_at >= ${baseDateExp} - :days
      GROUP BY region, district_code, legal_dong, apartment_name, TRUNC(area_m2)
    `, { days: lookbackDays });

    const saleStats = (saleResult.rows || []).map((row: any) => ({
      id: `SALE|${row.REGION}|${row.DISTRICT_CODE}|${row.APARTMENT_NAME}|${row.AREA_GROUP}`,
      region: row.REGION,
      district_code: row.DISTRICT_CODE,
      legal_dong: row.LEGAL_DONG,
      apartment_name: row.APARTMENT_NAME,
      area_m2: Number(row.AREA_GROUP),
      trade_type: 'SALE',
      avg_price_krw: Number(row.AVG_PRICE),
      avg_deposit_krw: 0,
      avg_monthly_rent_krw: 0,
      tx_count: Number(row.TX_COUNT)
    }));

    // 2. Rent Aggregation
    const rentResult = await connection.execute(`
      SELECT 
        region, district_code, legal_dong, apartment_name, rent_type,
        TRUNC(area_m2) as area_group,
        ROUND(AVG(deposit_krw)) as avg_deposit,
        ROUND(AVG(monthly_rent_krw)) as avg_rent,
        COUNT(*) as tx_count
      FROM re_rent_transactions
      WHERE contracted_at >= ${baseDateExp} - :days
      GROUP BY region, district_code, legal_dong, apartment_name, rent_type, TRUNC(area_m2)
    `, { days: lookbackDays });

    const rentStats = (rentResult.rows || []).map((row: any) => ({
      id: `${row.RENT_TYPE}|${row.REGION}|${row.DISTRICT_CODE}|${row.APARTMENT_NAME}|${row.AREA_GROUP}`,
      region: row.REGION,
      district_code: row.DISTRICT_CODE,
      legal_dong: row.LEGAL_DONG,
      apartment_name: row.APARTMENT_NAME,
      area_m2: Number(row.AREA_GROUP),
      trade_type: row.RENT_TYPE,
      avg_price_krw: 0,
      avg_deposit_krw: Number(row.AVG_DEPOSIT),
      avg_monthly_rent_krw: Number(row.AVG_RENT),
      tx_count: Number(row.TX_COUNT)
    }));

    const allStats = [...saleStats, ...rentStats];
    console.log(`[AGGREGATE] Total groups calculated: ${allStats.length}`);

    if (allStats.length > 0) {
      await upsertRecentAreaStats(allStats);
      console.log(`[AGGREGATE] Successfully updated ${allStats.length} stats.`);
    }
  });
};

main().catch(err => {
  console.error("[AGGREGATE] Failed:", err);
  process.exit(1);
});
