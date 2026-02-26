import "dotenv/config";
import { executeSelectQuery } from "../lib/store.js";
async function main() {
   const sale = await executeSelectQuery("SELECT DISTINCT APARTMENT_NAME, LEGAL_DONG FROM RE_SALE_TRANSACTIONS WHERE APARTMENT_NAME LIKE '%유천%'");
   console.log("Found matches:", sale);
}
main();
