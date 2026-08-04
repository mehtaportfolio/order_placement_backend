import { downloadCsv } from "../utils/nseDownloader.js";
import { parseCsv } from "../utils/csvParser.js";

const csv = await downloadCsv(
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
  "https://www.nseindia.com/"
);

const rows = parseCsv(csv);

console.log("Total:", rows.length);

console.log(rows[0]);

console.log(Object.keys(rows[0]));