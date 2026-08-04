import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });


import { fetchT2T } from "../services/surveillance/t2tService.js";
import { refreshSource } from "../services/surveillance/surveillanceRepository.js";


async function test() {

  try {

    const records = await fetchT2T();


    console.log(
      `Fetched ${records.length} T2T records`
    );


    console.log(records[0]);


    const count = await refreshSource(
      "EQUITY_L",
      records
    );


    console.log(
      `Inserted ${count} T2T records into stock_surveillance`
    );


  } catch(error) {

    console.error(error);

  }

}


test();