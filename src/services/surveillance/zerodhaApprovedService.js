import { supabase } from "../../db/supabaseClient.js";

const URL = "https://public.zrd.sh/crux/approved-securities.json";

export async function fetchZerodhaApproved() {
  // Download Zerodha approved securities JSON
  const response = await fetch(URL);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Zerodha approved securities: ${response.status}`
    );
  }

  const data = await response.json();

  // Fetch only BSE stocks from stock_master
  const { data: bseStocks, error } = await supabase
    .from("stock_master")
    .select("stock_name")
    .eq("exchange", "bse");

  if (error) {
    throw error;
  }

  // Create lookup set for fast matching
  const bseSymbols = new Set(
    bseStocks.map((row) => row.stock_name.toUpperCase())
  );

const approvedSymbols = new Set(
  data.map((item) => item.symbol.toUpperCase())
);

const matched = [];
const missing = [];

for (const row of bseStocks) {
  if (approvedSymbols.has(row.stock_name.toUpperCase())) {
    matched.push(row.stock_name);
  } else {
    missing.push(row.stock_name);
  }
}

console.log("BSE stocks in stock_master:", bseStocks.length);
console.log("Matched:", matched.length);
console.log(matched);

console.log("Missing:", missing.length);
console.log(missing);

const records = data
  .filter((item) => bseSymbols.has(item.symbol.toUpperCase()))
  .map((item) => ({
    stock_name: item.symbol,
    stock_company_name: item.security_name,
    isin: item.isin,
    surveillance_type: "SERIES",
    surveillance_stage: item.security_type,
    effective_date: null,
    source: "ZERODHA_API",
    updated_at: new Date().toISOString(),
  }));

  console.log(`Fetched ${records.length} Zerodha approved records`);

  return records;
}