import dotenv from "dotenv";

dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalNumber = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  oracleUser: required("ORACLE_USER"),
  oraclePassword: required("ORACLE_PASSWORD"),
  oracleConnectString: required("ORACLE_CONNECT_STRING"),

  // For Autonomous DB wallets (TNS_ADMIN / wallet)
  oracleWalletDir: process.env.ORACLE_WALLET_DIR,
  oracleWalletPassword: process.env.ORACLE_WALLET_PASSWORD,

  oraclePoolMin: optionalNumber("ORACLE_POOL_MIN", 1),
  oraclePoolMax: optionalNumber("ORACLE_POOL_MAX", 10),
  oraclePoolIncrement: optionalNumber("ORACLE_POOL_INCREMENT", 1),

  molitServiceKey: process.env.MOLIT_SERVICE_KEY,
  molitApiBase:
    process.env.MOLIT_API_BASE ??
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
  molitRentApiBase:
    process.env.MOLIT_RENT_API_BASE ??
    "http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
};

export const seoulMetroDistricts = [
  { region: "서울", lawdCd: "11110" },
  { region: "서울", lawdCd: "11680" },
  { region: "서울", lawdCd: "11710" },
  { region: "경기", lawdCd: "41135" },
  { region: "경기", lawdCd: "41465" },
  { region: "경기", lawdCd: "41281" },
  { region: "인천", lawdCd: "28177" },
  { region: "인천", lawdCd: "28237" }
] as const;
