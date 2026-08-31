import cron from 'node-cron';
import logger from './logger.js';
import fundService from './fundService.js';

/**
 * Sets up scheduled tasks for Zerodha
 */
const initializeZerodhaScheduler = () => {
    logger.info('Initializing Zerodha daily scheduler...');

    // Schedule Daily Fund Fetch - 4:00 PM IST
    cron.schedule('0 16 * * *', async () => {
        logger.info('Running scheduled Zerodha fund value fetch (4:00 PM IST)...');
        try {
            await fundService.fetchAndLogZerodhaFunds();
        } catch (error) {
            logger.error(`Scheduled Zerodha fund fetch failed: ${error.message}`);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    logger.info('Zerodha scheduler successfully initialized');
};

export default initializeZerodhaScheduler;
