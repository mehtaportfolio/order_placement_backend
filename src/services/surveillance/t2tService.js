import { downloadCsv } from "../../utils/nseDownloader.js";
import { parseCsv } from "../../utils/csvParser.js";

const EQUITY_URL =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

const EQUITY_REFERER =
  "https://www.nseindia.com/";


export async function fetchT2T() {

  const csvText = await downloadCsv(
    EQUITY_URL,
    EQUITY_REFERER
  );


  const rows = parseCsv(csvText);


  const records = rows
    .filter(row => row["SYMBOL"] && row["SYMBOL"].trim() !== "")
    .map(row => ({
      
      stock_name: row["SYMBOL"].trim(),

      stock_company_name:
        row["NAME OF COMPANY"]?.trim() || "",

      isin:
        row["ISIN NUMBER"]?.trim() || "",

      surveillance_type: "SERIES",

      surveillance_stage:
        row["SERIES"]?.trim() || null,

      effective_date: null,

      source: "EQUITY_L",

      updated_at: new Date().toISOString()

    }));


  return records;
}