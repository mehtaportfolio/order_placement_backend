import { downloadCsv } from "../../utils/nseDownloader.js";
import { parseCsv } from "../../utils/csvParser.js";

const GSM_URL = "https://www.nseindia.com/api/reportGSM?csv=true";
const GSM_REFERER = "https://www.nseindia.com/reports/gsm";

function extractGSMStage(stage) {
  if (!stage) return null;

  stage = stage.trim();

  // GSM numeric stage
  let match = stage.match(/GSM\s+(\d+)/i);
  if (match) {
    return match[1];
  }

  // GSM roman stage
  match = stage.match(/GSM\s+(I|II|III|IV|V|VI)/i);
  if (match) {
    return match[1].toUpperCase();
  }

  return stage;
}

export async function fetchGSM() {
  try {
    const csvText = await downloadCsv(GSM_URL, GSM_REFERER);

    const rows = parseCsv(csvText);

    const records = rows
      .filter(row => row["SYMBOL"] && row["SYMBOL"].trim() !== "")
      .map(row => ({
        stock_name: row["SYMBOL"].trim(),

        stock_company_name: row["COMPANY NAME"].trim(),

        isin: row["ISIN"].trim(),

        surveillance_type: "GSM",

        surveillance_stage: extractGSMStage(row["GSM STAGE"]),

        effective_date: null,

        source: "GSM_API",

        updated_at: new Date().toISOString()
      }));

    return records;
  } catch (error) {
    console.error("[GSM] Failed to fetch GSM report:", error);
    throw error;
  }
}