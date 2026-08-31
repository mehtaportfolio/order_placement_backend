import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const loadEnvConfig = () => {
  if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: '.env.backend' });
  }

  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  };
};

const createSupabaseClient = (url, key) => {
  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

let sharedSupabase = null;

export function getSupabase() {
  if (sharedSupabase) {
    return sharedSupabase;
  }

  const { url, key } = loadEnvConfig();
  sharedSupabase = createSupabaseClient(url, key);

  if (!sharedSupabase) {
    throw new Error('Supabase environment variables are missing.');
  }

  return sharedSupabase;
}

export const supabase = (() => {
  try {
    return getSupabase();
  } catch (error) {
    return null;
  }
})();