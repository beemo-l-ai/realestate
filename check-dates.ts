import { executeSelectQuery } from "./src/lib/store.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Checking Available Months in DB...");
  const saleRows = await executeSelectQuery("SELECT DISTINCT year_month FROM re_sale_monthly_aggregates ORDER BY year_month ASC");
  console.log("Sale data months:", saleRows.map((r: any) => r.YEAR_MONTH).join(", "));
  
  const rentRows = await executeSelectQuery("SELECT DISTINCT year_month FROM re_rent_monthly_aggregates ORDER BY year_month ASC");
  console.log("Rent data months:", rentRows.map((r: any) => r.YEAR_MONTH).join(", "));
}

main().catch(console.error);
