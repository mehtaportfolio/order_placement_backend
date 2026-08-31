import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });

import { fetchASM } from "../services/surveillance/asmService.js";
import { refreshSource } from "../services/surveillance/surveillanceRepository.js";
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("SUPABASE_ANON_KEY:", !!process.env.SUPABASE_ANON_KEY);

async function test() {
  try {
    const records = await fetchASM();

    console.log(`Fetched ${records.length} ASM records`);

    const count = await refreshSource("ASM_API", records);

    console.log(`Inserted ${count} ASM records into stock_surveillance`);
  } catch (err) {
    console.error(err);
  }
}

test();