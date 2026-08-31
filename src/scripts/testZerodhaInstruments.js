import dotenv from "dotenv";

dotenv.config({ path: ".env.backend" });

import kiteClient from "../services/zerodha/kiteClient.js";

async function test() {
  try {
    // Use any logged-in account
    const kite = await kiteClient.getInstance("PM");

    console.log("Downloading Zerodha instruments...");

    const instruments = await kite.getInstruments();

    console.log(Object.keys(instruments[0]));
console.log(instruments[0]);

    console.log(`Total instruments: ${instruments.length}`);

    const sample = instruments.filter(
      (i) =>
        (i.exchange === "NSE" || i.exchange === "BSE") &&
        ["RELIANCE", "INFY", "TCS", "ABB", "NSDL"].includes(i.tradingsymbol)
    );

    console.table(
      sample.map((i) => ({
        exchange: i.exchange,
        symbol: i.tradingsymbol,
        company: i.name,
        isin: i.isin,
        instrument_token: i.instrument_token,
        exchange_token: i.exchange_token,
        segment: i.segment,
      }))
    );
  } catch (err) {
    console.error(err);
  }
}

test();