import { downloadCsv } from "../../utils/nseDownloader.js";
import { parseCsv } from "../../utils/csvParser.js";

const ESM_URL = "https://www.nseindia.com/api/reportESM?csv=true";
const ESM_REFERER = "https://www.nseindia.com/reports/esm";


function extractESMStage(stage) {
  if (!stage) return null;

  const match = stage.match(/\b(I|II|III|IV|V|VI)\b/);

  return match ? match[1] : stage.trim();
}


export async function fetchESM() {

  const csvText = await downloadCsv(
    ESM_URL,
    ESM_REFERER
  );

  const rows = parseCsv(csvText);


  const records = rows
    .filter(row => row["SYMBOL"] && row["SYMBOL"].trim() !== "")
    .map(row => ({
      stock_name: row["SYMBOL"].trim(),

      stock_company_name: row["COMPANY NAME"].trim(),

      isin: row["ISIN"].trim(),

      surveillance_type: "ESM",

      surveillance_stage: extractESMStage(row["ESM STAGE"]),

      effective_date: null,

      source: "ESM_API",

      updated_at: new Date().toISOString()
    }));


  return records;
}