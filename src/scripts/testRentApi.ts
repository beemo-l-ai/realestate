import { config } from "../lib/config.js";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

async function main() {
  const districtCode = "11110";
  const yearMonth = "202401";

  const normalizeServiceKey = (serviceKey: string): string => {
    if (!serviceKey.includes("%")) return serviceKey;
    try { return decodeURIComponent(serviceKey); } catch { return serviceKey; }
  };

  const url = new URL(config.molitRentApiBase);
  url.searchParams.set("serviceKey", normalizeServiceKey(config.molitServiceKey!));
  url.searchParams.set("LAWD_CD", districtCode);
  url.searchParams.set("DEAL_YMD", yearMonth);
  url.searchParams.set("numOfRows", "10"); // just 10 for testing

  console.log("Fetching url (hidden key):", url.toString().replace(config.molitServiceKey!, "SECRET"));
  const response = await fetch(url, { headers: { Accept: "application/xml" } });

  if (!response.ok) {
    console.error("Failed:", response.status, response.statusText);
    process.exit(1);
  }

  const xml = await response.text();
  console.log("Response XML start:\n", xml.slice(0, 500));

  const json = parser.parse(xml);
  const items = json.response?.body?.items?.item;

  if (!items) {
    console.log("No items found");
    return;
  }

  const rows = Array.isArray(items) ? items : [items];
  console.log(`Found ${rows.length} items. First item:`);
  console.log(JSON.stringify(rows[0], null, 2));
}

main().catch(console.error);
