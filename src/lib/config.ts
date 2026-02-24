import dotenv from "dotenv";

dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  firebaseProjectId: required("FIREBASE_PROJECT_ID"),
  firebaseClientEmail: required("FIREBASE_CLIENT_EMAIL"),
  firebasePrivateKey: required("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  molitServiceKey: process.env.MOLIT_SERVICE_KEY,
  molitApiBase:
    process.env.MOLIT_API_BASE ??
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
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
