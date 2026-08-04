import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });


import { fetchETF } from "../services/surveillance/etfService.js";


async function test() {

  const records = await fetchETF();

  console.log("Fetched ETF Records:", records.length);

  console.table(records.slice(0,10));

}


test();