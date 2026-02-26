import "dotenv/config";
import { searchApartmentMetadata, executeSelectQuery } from "../lib/store.js";

async function main() {
    try {
        const meta = await searchApartmentMetadata({ nameContains: '화인' });
        console.log("Found in metadata:", meta);

        const sale = await executeSelectQuery("SELECT DISTINCT APARTMENT_NAME, LEGAL_DONG FROM RE_SALE_TRANSACTIONS WHERE APARTMENT_NAME LIKE '%화인%'");
        console.log("Found in sale transactions:", sale);

        const rent = await executeSelectQuery("SELECT DISTINCT APARTMENT_NAME, LEGAL_DONG FROM RE_RENT_TRANSACTIONS WHERE APARTMENT_NAME LIKE '%화인%'");
        console.log("Found in rent transactions:", rent);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
