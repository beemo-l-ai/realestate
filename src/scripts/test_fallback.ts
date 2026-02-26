import "dotenv/config";
import { searchApartmentMetadata } from "../lib/store.js";
async function main() {
   console.log("Testing fallback search for 화인 in 금곡동...");
   let candidates = await searchApartmentMetadata({ nameContains: '화인', legalDong: '금곡동', limit: 10 });
   console.log("Keyword search (화인):", candidates.length);
   if (candidates.length === 0) {
     candidates = await searchApartmentMetadata({ legalDong: '금곡동', limit: 50 });
     console.log("Fallback search (금곡동):", candidates.length);
     console.log("Sample fallback candidates:", candidates.slice(0, 5).map(c => c.apartmentName));
   }
}
main();
