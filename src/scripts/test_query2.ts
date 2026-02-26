import "dotenv/config";
import { executeSelectQuery } from "../lib/store.js";
async function main() {
   const sale = await executeSelectQuery("SELECT DISTINCT APARTMENT_NAME, LEGAL_DONG FROM RE_SALE_TRANSACTIONS FETCH FIRST 10 ROWS ONLY");
   console.log("Some sales:", sale);
}
main();
