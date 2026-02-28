import { executeSelectQuery } from "../lib/store.js";

async function main() {
    try {
        const sale = await executeSelectQuery("SELECT MAX(traded_at) as max_date FROM re_sale_transactions");
        console.log("Latest sale date:", sale[0].MAX_DATE);

        const rent = await executeSelectQuery("SELECT MAX(contracted_at) as max_date FROM re_rent_transactions");
        console.log("Latest rent date:", rent[0].MAX_DATE);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
