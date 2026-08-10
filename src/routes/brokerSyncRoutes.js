import express from 'express';
import { syncBrokerOrdersFromBrokerAccounts } from '../services/orderTrackerService.js';
import { runSurveillanceSync } from '../services/surveillance/surveillanceSyncRunner.js';

const router = express.Router();

router.post('/sync-broker-history', async (req, res) => {
  try {
    // Start the sync in the background.
    // Do NOT await it here.
    syncBrokerOrdersFromBrokerAccounts()
      .then((summary) => {
        console.log('[BrokerSync] Background sync completed:', summary);
      })
      .catch((error) => {
        console.error(
          '[BrokerSync] Background sync failed:',
          error.message
        );
      });

    // Respond immediately to the frontend
    return res.status(202).json({
      success: true,
      message: 'Broker history sync started',
    });
  } catch (error) {
    console.error(
      '[BrokerSync] Error starting broker history sync:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
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
