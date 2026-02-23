export interface RawTradeRow {
  법정동: string;
  아파트: string;
  년: string;
  월: string;
  일: string;
  전용면적: string;
  거래금액: string;
  층: string;
  지번: string;
  지역코드: string;
}

export interface TradeRecord {
  id: string;
  region: string;
  districtCode: string;
  legalDong: string;
  apartmentName: string;
  areaM2: number;
  priceKrw: number;
  floor: number;
  tradedAt: string;
  source: "MOLIT_RTMS";
  collectedAt: string;
}

export interface MonthlyAggregate {
  region: string;
  districtCode: string;
  apartmentName?: string;
  yearMonth: string;
  avgPriceKrw: number;
  medianPriceKrw: number;
  minPriceKrw: number;
  maxPriceKrw: number;
  txCount: number;
}
