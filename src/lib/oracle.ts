import oracledb from "oracledb";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

(oracledb as any).outFormat = (oracledb as any).OUT_FORMAT_OBJECT;
(oracledb as any).fetchAsString = [(oracledb as any).CLOB];

let poolPromise: Promise<any> | null = null;

const resolveWalletDir = (walletDir?: string): string | undefined => {
  if (!walletDir) return undefined;

  const directTns = path.join(walletDir, "tnsnames.ora");
  if (fs.existsSync(directTns)) return walletDir;

  // Common upload pattern: wallet files are nested once (e.g. oracle-wallet/oracle-wallet/*)
  const nestedCandidates = fs
    .readdirSync(walletDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(walletDir, entry.name));

  for (const candidate of nestedCandidates) {
    if (fs.existsSync(path.join(candidate, "tnsnames.ora"))) {
      console.warn(`[oracle] ORACLE_WALLET_DIR adjusted to nested folder: ${candidate}`);
      return candidate;
    }
  }

  console.warn(`[oracle] tnsnames.ora not found under ORACLE_WALLET_DIR=${walletDir}`);
  return walletDir;
};

export const getOraclePool = async (): Promise<any> => {
  if (!poolPromise) {
    const walletDir = resolveWalletDir(config.oracleWalletDir);
    const walletPassword = config.oracleWalletPassword;

    poolPromise = (oracledb as any).createPool({
      user: config.oracleUser,
      password: config.oraclePassword,
      connectString: config.oracleConnectString,

      ...(walletDir
        ? {
            // Thin mode supports Autonomous DB wallets via configDir/walletLocation.
            // Using the wallet also enables TNS aliases (e.g. "realestate_high").
            configDir: walletDir,
            walletLocation: walletDir,
            ...(walletPassword ? { walletPassword } : {}),
          }
        : {}),

      poolMin: config.oraclePoolMin,
      poolMax: config.oraclePoolMax,
      poolIncrement: config.oraclePoolIncrement,
    });
  }

  return await poolPromise;
};

export const withOracleConnection = async <T>(fn: (connection: any) => Promise<T>): Promise<T> => {
  const pool = await getOraclePool();
  const connection = await pool.getConnection();
  try {
    // Avoid ORA-12838 issues if the DB/session ends up with parallel DML enabled somewhere.
    // If it's not enabled, this is a no-op.
    try {
      await connection.execute("ALTER SESSION DISABLE PARALLEL DML");
    } catch {
      // ignore
    }

    return await fn(connection);
  } finally {
    await connection.close();
  }
};

export const closeOraclePool = async (): Promise<void> => {
  if (!poolPromise) return;
  const pool = await poolPromise;
  await pool.close(10);
  poolPromise = null;
};
