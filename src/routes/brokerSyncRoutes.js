import express from 'express';
import { syncBrokerOrdersFromBrokerAccounts } from '../services/orderTrackerService.js';
import { runSurveillanceSync } from '../services/surveillance/surveillanceSyncRunner.js';

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

router.post('/surveillance', async (req, res) => {
  try {
    const result = await runSurveillanceSync();
    res.json(result);
  } catch (error) {
    console.error('[BrokerSync] Error syncing surveillance:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Surveillance sync failed. Please try again.' });
  }
});

export default router;
