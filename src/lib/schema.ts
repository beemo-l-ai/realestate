import { withOracleConnection } from "./oracle.js";

const DDLS = [
  `CREATE TABLE re_sale_transactions (
    id VARCHAR2(320) PRIMARY KEY,
    region VARCHAR2(12) NOT NULL,
    district_code VARCHAR2(10) NOT NULL,
    legal_dong VARCHAR2(120) NOT NULL,
    apartment_name VARCHAR2(200) NOT NULL,
    area_m2 NUMBER(8,2) NOT NULL,
    price_krw NUMBER(15) NOT NULL,
    floor NUMBER(4),
    traded_at DATE NOT NULL,
    source VARCHAR2(40) NOT NULL,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL
  )`,
  `CREATE TABLE re_rent_transactions (
    id VARCHAR2(320) PRIMARY KEY,
    region VARCHAR2(12) NOT NULL,
    district_code VARCHAR2(10) NOT NULL,
    legal_dong VARCHAR2(120) NOT NULL,
    apartment_name VARCHAR2(200) NOT NULL,
    area_m2 NUMBER(8,2) NOT NULL,
    rent_type VARCHAR2(10) NOT NULL,
    deposit_krw NUMBER(15) NOT NULL,
    monthly_rent_krw NUMBER(12) DEFAULT 0 NOT NULL,
    floor NUMBER(4),
    contracted_at DATE NOT NULL,
    source VARCHAR2(40) NOT NULL,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT chk_re_rent_type CHECK (rent_type IN ('JEONSE', 'WOLSE'))
  )`,
  `CREATE TABLE re_apartment_metadata (
    id VARCHAR2(260) PRIMARY KEY,
    region VARCHAR2(12) NOT NULL,
    district_code VARCHAR2(10) NOT NULL,
    legal_dong VARCHAR2(120) NOT NULL,
    apartment_name VARCHAR2(200) NOT NULL,
    total_sale_trades NUMBER(10) DEFAULT 0 NOT NULL,
    last_sale_traded_at DATE NOT NULL
  )`,
  `CREATE TABLE re_apartment_areas (
    metadata_id VARCHAR2(260) NOT NULL,
    area_m2 NUMBER(8,2) NOT NULL,
    CONSTRAINT pk_re_apartment_areas PRIMARY KEY (metadata_id, area_m2),
    CONSTRAINT fk_re_apartment_areas_meta FOREIGN KEY (metadata_id)
      REFERENCES re_apartment_metadata(id)
  )`,
  `CREATE TABLE re_sale_monthly_aggregates (
    id VARCHAR2(260) PRIMARY KEY,
    region VARCHAR2(12) NOT NULL,
    district_code VARCHAR2(10) NOT NULL,
    apartment_name VARCHAR2(200),
    year_month CHAR(6) NOT NULL,
    avg_price_krw NUMBER(15) NOT NULL,
    median_price_krw NUMBER(15) NOT NULL,
    min_price_krw NUMBER(15) NOT NULL,
    max_price_krw NUMBER(15) NOT NULL,
    tx_count NUMBER(10) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
  )`,
  `CREATE TABLE re_rent_monthly_aggregates (
    id VARCHAR2(280) PRIMARY KEY,
    region VARCHAR2(12) NOT NULL,
    district_code VARCHAR2(10) NOT NULL,
    apartment_name VARCHAR2(200),
    rent_type VARCHAR2(10) NOT NULL,
    year_month CHAR(6) NOT NULL,
    avg_deposit_krw NUMBER(15) NOT NULL,
    avg_monthly_rent_krw NUMBER(12) NOT NULL,
    tx_count NUMBER(10) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT chk_re_rent_agg_type CHECK (rent_type IN ('JEONSE', 'WOLSE'))
  )`,
  "CREATE INDEX ix_re_sale_ym_district ON re_sale_monthly_aggregates(year_month, district_code)",
  "CREATE INDEX ix_re_sale_district_apt_ym ON re_sale_monthly_aggregates(district_code, apartment_name, year_month)",
  "CREATE INDEX ix_re_sale_tx_district_date ON re_sale_transactions(district_code, traded_at DESC)",
  "CREATE INDEX ix_re_sale_tx_region_date ON re_sale_transactions(region, traded_at DESC)",
  "CREATE INDEX ix_re_sale_tx_apt ON re_sale_transactions(district_code, apartment_name, traded_at DESC)",
  "CREATE INDEX ix_re_sale_tx_area ON re_sale_transactions(district_code, apartment_name, area_m2)",
  "CREATE INDEX ix_re_rent_tx_district_date ON re_rent_transactions(district_code, contracted_at DESC)",
  "CREATE INDEX ix_re_rent_tx_region_date ON re_rent_transactions(region, contracted_at DESC)",
  "CREATE INDEX ix_re_rent_tx_apt ON re_rent_transactions(district_code, apartment_name, contracted_at DESC)",
  "CREATE INDEX ix_re_metadata_district_apt ON re_apartment_metadata(district_code, apartment_name)",
  "CREATE INDEX ix_re_metadata_total_trades ON re_apartment_metadata(district_code, total_sale_trades DESC)",
  "CREATE INDEX ix_re_rent_ym_district ON re_rent_monthly_aggregates(year_month, district_code, rent_type)",
  "CREATE INDEX ix_re_rent_district_apt_ym ON re_rent_monthly_aggregates(district_code, apartment_name, rent_type, year_month)"
];

let initialized = false;

const isAlreadyExistsError = (error: unknown): boolean => {
  const oraError = error as { errorNum?: number } | undefined;
  return oraError?.errorNum === 955 || oraError?.errorNum === 2260 || oraError?.errorNum === 2275;
};

export const ensureOracleSchema = async (): Promise<void> => {
  if (initialized) return;

  await withOracleConnection(async (connection) => {
    for (const ddl of DDLS) {
      try {
        await connection.execute(ddl);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    }

    await connection.commit();
  });

  initialized = true;
};
