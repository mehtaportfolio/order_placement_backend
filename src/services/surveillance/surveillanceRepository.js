import { getSupabase } from "../../db/supabaseClient.js";

/**
 * Delete all records for a specific source.
 * Example sources:
 * ASM_API
 * GSM_API
 * ESM_API
 * EQUITY_L
 */
export async function deleteBySource(source) {

const supabase = getSupabase();
  const { error } = await supabase
    .from("stock_surveillance")
    .delete()
    .eq("source", source);

  if (error) {
    throw error;
  }
}

/**
 * Bulk insert surveillance records.
 */
export async function bulkInsert(records) {
  if (!records || records.length === 0) {
    return;
  }

const supabase = getSupabase();
  const { error } = await supabase
    .from("stock_surveillance")
    .insert(records);

  if (error) {
    throw error;
  }
}

/**
 * Refresh one source.
 * Deletes previous rows and inserts latest rows.
 */
export async function refreshSource(source, records) {
  await deleteBySource(source);

  if (records.length > 0) {
    await bulkInsert(records);
  }

  return records.length;
}

/**
 * Get surveillance records for one stock.
 */
export async function getByStock(stockName) {

const supabase = getSupabase();
  const { data, error } = await supabase
    .from("stock_surveillance")
    .select("*")
    .eq("stock_name", stockName)
    .order("surveillance_type");

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get all stocks in one surveillance category.
 * Example:
 * ASM
 * GSM
 * ESM
 * T2T
 */
export async function getByType(type) {
const supabase = getSupabase();
  const { data, error } = await supabase
    .from("stock_surveillance")
    .select("*")
    .eq("surveillance_type", type)
    .order("stock_name");

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get all surveillance records.
 */
export async function getAll() {
const supabase = getSupabase();
  const { data, error } = await supabase
    .from("stock_surveillance")
    .select("*")
    .order("stock_name");

  if (error) {
    throw error;
  }

  return data;
}