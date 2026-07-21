import { KiteConnect } from 'kiteconnect';
import logger from './logger.js';
import dotenv from 'dotenv';
import { supabase } from '../../db/supabaseClient.js';

dotenv.config();

/**
 * Reusable Kite client wrapper
 */
class KiteClient {
    constructor() {
        this.kc = null;
        this.apiKey = null;
    }

    async getAccessToken(accountId = null) {
        if (!accountId) {
            throw new Error('Account ID is required');
        }

        const { data, error } = await supabase
            .from('zerodha_tokens')
            .select('access_token')
            .eq('account_id', accountId)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error) {
            throw error;
        }

        const accessToken = data && data.length > 0 ? data[0].access_token : null;
        if (!accessToken) {
            logger.warn(`Zerodha token lookup failed for account ${accountId}: no token found in zerodha_tokens table`);
            throw new Error(`No access token found for Zerodha account ${accountId}`);
        }

        logger.info(`Zerodha token found for account ${accountId} from zerodha_tokens table for today; creating session`);
        return accessToken;
    }

    /**
     * Initializes or returns the KiteConnect instance
     */
    async getInstance(accountId = null) {
        try {
            const accessToken = await this.getAccessToken(accountId);

            let apiKey = process.env.KITE_API_KEY_Z1;
            if (accountId === 'PM') apiKey = process.env.KITE_API_KEY_Z1;
            else if (accountId === 'PDM') apiKey = process.env.KITE_API_KEY_Z2;
            else if (accountId === 'PSM') apiKey = process.env.KITE_API_KEY_Z3;

            if (!this.kc || this.kc.api_key !== apiKey || this.kc.access_token !== accessToken) {
                this.kc = new KiteConnect({
                    api_key: apiKey,
                    access_token: accessToken
                });
            } else {
                this.kc.access_token = accessToken;
            }

            return this.kc;
        } catch (error) {
            logger.error('Failed to initialize Kite instance', error);
            throw error;
        }
    }

    /**
     * Fetch user profile
     */
    async getProfile(accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.getProfile();
    }

    /**
     * Fetch holdings
     */
    async getHoldings(accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.getHoldings();
    }

    /**
     * Fetch positions
     */
    async getPositions(accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.getPositions();
    }

    /**
     * Fetch orders
     */
    async getOrders(accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.getOrders();
    }

    /**
     * Place order
     */
    async placeOrder(params, accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.placeOrder(params.variety || "regular", params);
    }

    /**
     * Fetch funds/margins
     */
    async getMargins(accountId = null) {
        const kc = await this.getInstance(accountId);
        return await kc.getMargins();
    }

    /**
     * Utility to check if client is ready
     */
    async isReady(accountId = null) {
        try {
            await this.getProfile(accountId);
            return true;
        } catch (error) {
            return false;
        }
    }
}

export default new KiteClient();
