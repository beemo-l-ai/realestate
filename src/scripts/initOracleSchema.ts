import { ensureOracleSchema } from "../lib/schema.js";
import { closeOraclePool } from "../lib/oracle.js";

const main = async (): Promise<void> => {
  try {
    await ensureOracleSchema();
    console.log("[DONE] Oracle schema and indexes are ready.");
  } finally {
    // Ensure the Node process can exit cleanly (pool keeps event loop alive)
    await closeOraclePool();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
