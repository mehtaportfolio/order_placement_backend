import express from 'express';
import { supabase } from '../db/supabaseClient.js';
import { fetchAllRows } from '../db/queries.js';

const router = express.Router();

function normalizeSymbolLocal(s) {
  if (!s) return s;
  s = s.toString().trim();
  return s.toUpperCase().endsWith('-EQ') ? s.slice(0, -3) : s;
}

// GET /api/diagnostics/unmapped-equity-positions
router.get('/unmapped-equity-positions', async (req, res) => {
  try {
    const { data: positions } = await fetchAllRows(supabase, 'equity_positions', { select: 'symbol, account_id, quantity, position_date' });

    const uniqueSymbols = Array.from(new Set((positions || []).map(p => normalizeSymbolLocal(p.symbol))));

    if (uniqueSymbols.length === 0) return res.json({ unmapped: [] });

    const { data: masters } = await supabase
      .from('stock_master')
      .select('stock_name')
      .in('stock_name', uniqueSymbols)
      .limit(10000);

    const found = new Set((masters || []).map(m => normalizeSymbolLocal(m.stock_name)));

    const unmapped = uniqueSymbols.filter(s => !found.has(s));

    res.json({ unmapped, count: unmapped.length });
  } catch (err) {
    console.error('[Diagnostics] unmapped-equity-positions error:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
