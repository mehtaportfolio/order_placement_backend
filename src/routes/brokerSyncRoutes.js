import express from 'express';
import { syncBrokerOrdersFromBrokerAccounts } from '../services/orderTrackerService.js';

const router = express.Router();

router.post('/sync-broker-history', async (req, res) => {
  try {
    const summary = await syncBrokerOrdersFromBrokerAccounts();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[BrokerSync] Error syncing broker history:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
