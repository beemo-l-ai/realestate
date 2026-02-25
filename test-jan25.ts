import { executeSelectQuery } from "./src/lib/store.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Checking Jan 2025 trades...");
  const rows = await executeSelectQuery("SELECT * FROM re_sale_transactions WHERE region = '서울' AND TO_CHAR(traded_at, 'YYYYMM') = '202501'");
  console.log(`Found ${rows.length} trades for Seoul in Jan 2025`);
  
  const aggs = await executeSelectQuery("SELECT sum(tx_count) as total_tx FROM re_sale_monthly_aggregates WHERE region = '서울' AND year_month = '202501' AND apartment_name IS NULL");
  console.log('Aggregates data:', aggs);
}
main().catch(console.error);
