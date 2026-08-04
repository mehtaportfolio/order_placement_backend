import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });


import { fetchESM } from "../services/surveillance/esmService.js";
import { refreshSource } from "../services/surveillance/surveillanceRepository.js";


async function test() {

  try {

    const records = await fetchESM();

    console.log(`Fetched ${records.length} ESM records`);

    console.log(records[0]);


    const count = await refreshSource(
      "ESM_API",
      records
    );


    console.log(
      `Inserted ${count} ESM records into stock_surveillance`
    );


  } catch(error) {

    console.error(error);

  }

}


test();