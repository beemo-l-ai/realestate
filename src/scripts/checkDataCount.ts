import { withOracleConnection, closeOraclePool } from "../lib/oracle.js";

const main = async () => {
  try {
    await withOracleConnection(async (connection) => {
      const tables = [
        "re_sale_transactions",
        "re_rent_transactions",
        "re_apartment_metadata",
        "re_sale_monthly_aggregates",
        "re_rent_monthly_aggregates"
      ];

      console.log("Checking row counts for tables...");

      for (const table of tables) {
        try {
          const result = await connection.execute(`SELECT count(*) as count FROM ${table}`);
          const count = result.rows[0][0]; // oracledb returns rows as arrays by default unless configured otherwise, but let's check output format.
          // In oracle.ts: (oracledb as any).outFormat = (oracledb as any).OUT_FORMAT_OBJECT;
          // So result.rows will be an array of objects if outFormat is object?
          // Wait, let's look at src/lib/oracle.ts again.
          // (oracledb as any).outFormat = (oracledb as any).OUT_FORMAT_OBJECT;
          // So result.rows will be [{ COUNT: 123 }] (case sensitive usually uppercase in Oracle)

          // Let's print the whole result to be safe or just access the property.
          // Oracle column names are usually uppercase.
          console.log(`${table}: ${JSON.stringify(result.rows)}`); 
        } catch (e) {
            console.error(`Error querying ${table}:`, e);
        }
      }
    });
  } catch (e) {
    console.error("Error connecting to DB:", e);
  } finally {
    await closeOraclePool();
  }
};

main();
