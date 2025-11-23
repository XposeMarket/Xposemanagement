/**
 * helpers/storage.js - PHASE 2 UPDATE
 * Local Storage + Supabase Data Management
 * Extracted functions from original app.js
 */

import { LS } from './constants.js';
import { getSupabaseClient } from './supabase.js';

// In-memory cache
let APP_CACHE = null;
let CACHE_LOADED = false;

/**
 * Read from localStorage with cache
 */
function readLS(k, f) {
  try {
    if (k === LS.data) {
      if (CACHE_LOADED) return APP_CACHE ?? (f ?? null);
      const raw = localStorage.getItem(LS.data);
      if (raw) {
        APP_CACHE = JSON.parse(raw);
        CACHE_LOADED = true;
        return APP_CACHE;
      }
      return f ?? null;
    }
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : (f ?? null);
  } catch (e) {
    console.warn('readLS error', k, e);
    return f ?? null;
  }
}

/**
 * Write to localStorage + background Supabase sync
 */
function writeLS(k, v) {
  try {
    if (k === LS.data) {
      APP_CACHE = v;
      CACHE_LOADED = true;
      localStorage.setItem(LS.data, JSON.stringify(v));

      const supabase = getSupabaseClient();
      if (supabase) {
        (async () => {
          try {
            // Get shop_id from session
            const session = readLS(LS.session, {});
            const shopId = session.shopId;
            
            if (!shopId) {
              console.warn('No shopId in session for Supabase sync');
              return;
            }

            // Upsert to data table as JSONB
            const { error } = await supabase
              .from('data')
              .upsert({
                shop_id: shopId,
                appointments: v.appointments || [],
                jobs: v.jobs || [],
                invoices: v.invoices || [],
                threads: v.threads || [],
                settings: v.settings || {},
                updated_at: new Date().toISOString()
              }, { onConflict: 'shop_id' });

            if (error) throw error;
            console.log('✅ Data synced to Supabase');
          } catch (e) {
            console.warn('Supabase sync failed (non-blocking):', e);
          }
        })();
      }
      return;
    }

    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    console.warn('writeLS error', k, e);
  }
}

/**
 * Get current cache
 */
function getCache() {
  return APP_CACHE;
}

/**
 * Clear cache on logout
 */
function clearCache() {
  APP_CACHE = {
    settings: {},
    appointments: [],
    jobs: [],
    threads: [],
    invoices: []
  };
  CACHE_LOADED = true;
  try {
    localStorage.setItem(LS.data, JSON.stringify(APP_CACHE));
  } catch (e) {
    console.warn('clearCache failed', e);
  }
}

/**
 * Get shop data from Supabase or localStorage
 * @param {string} shopId - shop ID
 * @returns {Promise<Object>} shop data
 */
async function getShopData(shopId) {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    // Fallback to localStorage
    const all = JSON.parse(localStorage.getItem(LS.data) || '{}');
    return all || { settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
  }
  
  try {
    const { data, error } = await supabase
      .from('data')
      .select('settings, appointments, jobs, threads, invoices')
      .eq('shop_id', shopId)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.warn('getShopData error:', error);
      return { settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
    }
    
    return data || { settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
  } catch (e) {
    console.warn('getShopData exception:', e);
    return { settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
  }
}

/**
 * Save shop data to Supabase or localStorage
 * @param {string} shopId - shop ID
 * @param {Object} data - shop data to save
 */
async function saveShopData(shopId, data) {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    try {
      localStorage.setItem(LS.data, JSON.stringify(data));
    } catch (e) {
      console.error(e);
    }
    return;
  }
  
  const { error } = await supabase.from('data').upsert({ 
    shop_id: shopId, 
    appointments: data.appointments || [],
    jobs: data.jobs || [],
    invoices: data.invoices || [],
    threads: data.threads || [],
    settings: data.settings || {},
    updated_at: new Date().toISOString()
  }, { onConflict: 'shop_id' });
  
  if (error) console.error('Save error:', error);
}

/**
 * Get all users from Supabase or localStorage
 * @returns {Promise<Array>} users array
 */
async function getUsers() {
  const supabase = getSupabaseClient();
  
  if (!supabase) return JSON.parse(localStorage.getItem(LS.users) || '[]');
  
  const { data, error } = await supabase.from('users').select('*');
  return error ? [] : data;
}

/**
 * Get all shops from Supabase or localStorage
 * @returns {Promise<Array>} shops array
 */
async function getShops() {
  const supabase = getSupabaseClient();
  
  if (!supabase) return JSON.parse(localStorage.getItem(LS.shops) || '[]');
  
  const { data, error } = await supabase.from('shops').select('*');
  return error ? [] : data;
}

export {
  readLS,
  writeLS,
  getCache,
  clearCache,
  getShopData,
  saveShopData,
  getUsers,
  getShops,
  APP_CACHE,
  CACHE_LOADED
};
