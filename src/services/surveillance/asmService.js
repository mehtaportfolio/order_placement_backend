import { downloadCsv } from "../../utils/nseDownloader.js";
import { parseCsv } from "../../utils/csvParser.js";

const ASM_URL = "https://www.nseindia.com/api/reportASM?csv=true";
const ASM_REFERER = "https://www.nseindia.com/reports/asm";


function extractASMStage(stage) {
  if (!stage) return null;

  const match = stage.match(/\b(I|II|III|IV)\b/);

  return match ? match[1] : stage;
}

export async function fetchASM() {
  try {
    const csvText = await downloadCsv(ASM_URL, ASM_REFERER);

    const rows = parseCsv(csvText);

const records = rows
  .filter(row => row["SYMBOL"] && row["SYMBOL"].trim() !== "")
  .map(row => ({
    stock_name: row["SYMBOL"].trim(),

    stock_company_name: row["COMPANY NAME"].trim(),

    isin: row["ISIN"].trim(),

    surveillance_type: "ASM",

    surveillance_stage: extractASMStage(row["ASM STAGE"]),

    effective_date: null,

    source: "ASM_API",

    updated_at: new Date().toISOString()
  }));

return records;
  } catch (error) {
    console.error("[ASM] Failed to fetch ASM report:", error);
    throw error;
  }
}