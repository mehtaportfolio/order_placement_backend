import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });

import { fetchGSM } from "../services/surveillance/gsmService.js";
import { refreshSource } from "../services/surveillance/surveillanceRepository.js";

async function test() {
  try {
    const records = await fetchGSM();

    console.log(`Fetched ${records.length} GSM records`);

    console.log(records[0]);

    const count = await refreshSource("GSM_API", records);

    console.log(`Inserted ${count} GSM records into stock_surveillance`);
  } catch (err) {
    console.error(err);
  }
}

test();