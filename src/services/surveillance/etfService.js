import axios from "axios";
import { parse } from "csv-parse/sync";


const ETF_URL =
  "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv";


export async function fetchETF() {

  const response = await axios.get(ETF_URL, {
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/csv,*/*",
      "Referer": "https://www.nseindia.com/"
    }
  });


  const rows = parse(response.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });


  return rows
    .filter(row => row.Symbol && row.ISINNumber)
    .map(row => ({
      stock_name: row.Symbol.trim(),

      stock_company_name:
        row.SecurityName?.trim() || row.Symbol.trim(),

      isin:
        row.ISINNumber.trim(),

      surveillance_type: "ETF",

      surveillance_stage: "ETF",

      effective_date: null,

      source: "ETF_API"
    }));

}