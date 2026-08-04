import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });

import { fetchASM } from "../services/surveillance/asmService.js";
import { fetchGSM } from "../services/surveillance/gsmService.js";
import { fetchESM } from "../services/surveillance/esmService.js";
import { fetchT2T } from "../services/surveillance/t2tService.js";
import { fetchETF } from "../services/surveillance/etfService.js";

import { refreshSource } from "../services/surveillance/surveillanceRepository.js";


async function syncModule(name, source, fetchFunction) {

  try {

    console.log(`\nStarting ${name} sync...`);

    const records = await fetchFunction();

    console.log(`Fetched ${records.length} ${name} records`);


    const count = await refreshSource(
      source,
      records
    );


    console.log(
      `${name} completed. Inserted ${count} records`
    );


  } catch(error) {

    console.error(
      `${name} failed:`,
      error.message
    );

  }

}


async function syncSurveillance() {

  console.log("========== Surveillance Sync Started ==========");


  await syncModule(
    "ASM",
    "ASM_API",
    fetchASM
  );


  await syncModule(
    "GSM",
    "GSM_API",
    fetchGSM
  );


  await syncModule(
    "ESM",
    "ESM_API",
    fetchESM
  );


  await syncModule(
    "T2T",
    "EQUITY_L",
    fetchT2T
  );

  await syncModule(
    "ETF",
    "ETF_API",
    fetchETF
  );


  console.log(
    "\n========== Surveillance Sync Completed =========="
  );

}


syncSurveillance();