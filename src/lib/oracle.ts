import oracledb from "oracledb";
import { config } from "./config.js";

(oracledb as any).outFormat = (oracledb as any).OUT_FORMAT_OBJECT;
(oracledb as any).fetchAsString = [(oracledb as any).CLOB];

let poolPromise: Promise<any> | null = null;

export const getOraclePool = async (): Promise<any> => {
  if (!poolPromise) {
    const walletDir = config.oracleWalletDir;
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
