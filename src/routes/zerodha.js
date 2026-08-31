import express from 'express';
import { supabase } from '../db/supabaseClient.js';

const router = express.Router();

// GET /api/zerodha/token?account=PSM
router.get('/token', async (req, res) => {
  try {
    const account = req.query.account;
    if (!account) return res.status(400).json({ error: 'account query param required' });

    const { data, error } = await supabase
      .from('zerodha_tokens')
      .select('*')
      .eq('account_id', account)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'no token found' });

    res.json({ token: data[0] });
  } catch (err) {
    console.error('[ZerodhaRoute] token fetch error:', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
