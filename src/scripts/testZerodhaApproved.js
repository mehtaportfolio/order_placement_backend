import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });

import { fetchZerodhaApproved } from "../services/surveillance/zerodhaApprovedService.js";
import { refreshSource } from "../services/surveillance/surveillanceRepository.js";

async function test() {
  try {
    const records = await fetchZerodhaApproved();

    console.log(`Fetched ${records.length} records`);

    const count = await refreshSource("ZERODHA_API", records);

    console.log(`Inserted ${count} records into stock_surveillance`);
  } catch (err) {
    console.error(err);
  }
}

test();