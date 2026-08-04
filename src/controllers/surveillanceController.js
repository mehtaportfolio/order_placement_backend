import { supabase } from "../db/supabaseClient.js";
import { getSurveillanceRestrictionForOrder } from '../utils/surveillanceRestriction.js';

const fetchAllPaginated = async ({ table, select, filters = [], pageSize = 1000 }) => {
  let allRows = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select);

    for (const filter of filters) {
      query = filter(query);
    }

    const { data, error } = await query.range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows = allRows.concat(data);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
};

export async function getStockSurveillance(req, res) {

  try {

    const { stock_name } = req.params;


    const { data, error } = await supabase
      .from("stock_surveillance_summary")
      .select("*")
      .eq("stock_name", stock_name.toUpperCase())
      .maybeSingle();


    if (error) {
      throw error;
    }


    if (!data) {
      return res.status(404).json({
        message: "No surveillance data found",
        stock_name
      });
    }


    res.json(data);

  } catch (error) {

    console.error(
      "[Surveillance] Error:",
      error.message
    );

    res.status(500).json({
      message: error.message
    });

  }

}

export async function getSurveillanceDashboard(req, res) {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase client is unavailable.' });
    }

    const surveillanceData = await fetchAllPaginated({
      table: 'stock_surveillance',
      select: 'stock_name, stock_company_name, isin, surveillance_type, surveillance_stage, effective_date, source, updated_at',
      filters: [
        (query) => query.order('stock_name').order('surveillance_type'),
      ],
    });

    const holdingsData = await fetchAllPaginated({
      table: 'stock_transactions',
      select: 'stock_name',
      filters: [
        (query) => query.is('sell_date', null),
      ],
    });

    const holdingNames = new Set(
      (holdingsData || [])
        .map((row) => String(row.stock_name || '').trim().toUpperCase())
        .filter(Boolean)
    );

    const rows = (surveillanceData || []).map((row) => {
      const stockName = String(row.stock_name || '').trim().toUpperCase();
      return {
        ...row,
        in_current_holdings: holdingNames.has(stockName),
      };
    });

    return res.json({ rows });
  } catch (error) {
    console.error('[Surveillance] Dashboard error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to load surveillance dashboard data.' });
  }
}

export async function checkSurveillanceRestriction(req, res) {
  try {
    const { stock_name } = req.params;
    const normalizedStock = String(stock_name || '').trim();

    if (!normalizedStock) {
      return res.status(400).json({ error: 'stock_name is required' });
    }

    const restriction = await getSurveillanceRestrictionForOrder({
      symbol: normalizedStock,
      orderType: 'MARKET',
    });

    return res.json({
      restricted: restriction.isRestricted,
      message: restriction.message || null,
    });
  } catch (error) {
    console.error('[Surveillance] Restriction check error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
