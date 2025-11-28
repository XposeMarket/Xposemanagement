import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
// Defer importing the catalog API until route handlers run. Importing at
// module-load time can throw if environment variables are missing in the
// serverless runtime and will cause the function invocation to fail.
async function loadCatalogAPI(){
  return await import('./helpers/catalog-api.js');
}
// Import messaging API
import messagingAPI from './helpers/messaging-api.js';
import { createClient } from '@supabase/supabase-js';
import serverless from 'serverless-http';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Node 18+ provides global fetch. Ensure your local Node is >=18 (`node -v`).
// Simple Express server exposing 3 routes backed by free public APIs.

const app = express();

app.use(express.json());
// Allow cross-origin requests from local frontends
app.use(cors());

// Helper: parse JSONP-like responses (CarQuery returns JSONP)
function parseMaybeJSONP(text){
  text = text.trim();
  if(!text) return null;
  // If text already starts with { or [, parse directly
  if(text[0] === '{' || text[0] === '[') {
    return JSON.parse(text);
  }
  // Otherwise try to find the first '{' and last '}' and parse substring
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if(first !== -1 && last !== -1 && last > first){
    const sub = text.substring(first, last + 1);
    return JSON.parse(sub);
  }
  // As a fallback, try to extract first '[' ... ']'
  const fArr = text.indexOf('[');
  const lArr = text.lastIndexOf(']');
  if(fArr !== -1 && lArr !== -1 && lArr > fArr){
    const sub = text.substring(fArr, lArr + 1);
    return JSON.parse(sub);
  }
  throw new Error('Unable to parse JSON/JSONP response');
}

// Route 1: /vin/:vin -> decode a VIN via NHTSA VPIC
app.get('/vin/:vin', async (req, res) => {
  try {
    const { vin } = req.params;
    if(!vin || vin.length < 11){
      return res.status(400).json({ error: 'VIN appears too short' });
    }

    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'NHTSA API error', status: r.status });
    const data = await r.json();

    // Return the VPIC payload (Results array usually contains single object)
    return res.json({ source: 'NHTSA VPIC', vin: vin.toUpperCase(), data });
  } catch (err) {
    console.error('VIN decode error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 2: /vehicle/:year/:make -> list trims from CarQuery
// CarQuery API (free) returns JSONP; we'll fetch it and parse safely
app.get('/vehicle/:year/:make', async (req, res) => {
  try {
    const year = Number(req.params.year) || null;
    const make = String(req.params.make || '').trim();
    if(!year || !make) return res.status(400).json({ error: 'Provide year and make' });

    // CarQuery endpoint
    const url = `https://www.carqueryapi.com/api/0.3/?cmd=getTrims&make=${encodeURIComponent(make)}&year=${encodeURIComponent(year)}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'CarQuery API error', status: r.status });
    const txt = await r.text();

    const parsed = parseMaybeJSONP(txt);

    // CarQuery returns an object with 'Trims' array
    const trims = parsed?.Trims || parsed?.trims || [];
    return res.json({ source: 'CarQuery', make, year, count: trims.length, trims });
  } catch (err) {
    console.error('CarQuery error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 3: /parts/:make/:model -> return CarQuery trims for that model (sample real data)
// Note: CarAPI.app endpoints sometimes require keys. To avoid requiring keys, we use CarQuery here which is public.
app.get('/parts/:make/:model', async (req, res) => {
  try {
    const make = String(req.params.make || '').trim();
    const model = String(req.params.model || '').trim();
    if(!make || !model) return res.status(400).json({ error: 'Provide make and model' });

    // Use CarQuery to fetch trims for the make and filter by model name
    const url = `https://www.carqueryapi.com/api/0.3/?cmd=getTrims&make=${encodeURIComponent(make)}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'CarQuery API error', status: r.status });
    const txt = await r.text();
    const parsed = parseMaybeJSONP(txt);
    const trims = parsed?.Trims || [];

    // Filter trims by model name (case-insensitive contains)
    const matches = trims.filter(t => (t.model_name || '').toLowerCase().includes(model.toLowerCase()));

    // Return the matched trims as 'parts-like' data (real trims data can be used to map parts downstream)
    return res.json({ source: 'CarQuery (as parts/trim sample)', make, model, matchesCount: matches.length, matches });
  } catch (err) {
    console.error('Parts endpoint error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 3.5: /search-parts -> For parts-test.html compatibility (mock for now)
app.post('/search-parts', async (req, res) => {
  // Mock response for testing
  const items = [
    {
      url: "https://autozone.com/part123",
      title: "Duralast Gold Front Brake Pads DG1243",
      source_domain: "AutoZone",
      estimated_price: "$54.99",
      snippet: "Confirmed Fit - In stock",
      part_number: "DG1243",
      confidence: 0.95
    },
    {
      url: "https://oreillyauto.com/part456",
      title: "ACDelco Professional Front Brake Pads 17D1234M",
      source_domain: "O'Reilly",
      estimated_price: "$49.99",
      snippet: "Confirmed Fit - In stock",
      part_number: "17D1234M",
      confidence: 0.9
    }
  ];
  return res.json({ items });
});

// NOTE: grok/Claude/Tavily integration removed — platform is AI-free.

// ===== PARTS CATALOG API ROUTES =====
console.log('🔧 Registering catalog API routes...');

// Get all years (1990-2025)
app.get('/api/catalog/years', async (req, res) => {
  console.log('📅 Years endpoint called');
  try {
    // Debug: print envs and Supabase client creation
    const envDebug = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_KEY: process.env.SUPABASE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV,
    };
    // Log only presence of key env vars (do NOT print actual secret values)
    console.log('ENV DEBUG: SUPABASE_URL set=', !!process.env.SUPABASE_URL, ', SUPABASE_SERVICE_ROLE_KEY set=', !!process.env.SUPABASE_SERVICE_ROLE_KEY, ', NODE_ENV=', process.env.NODE_ENV);
    const catalogAPI = await loadCatalogAPI();
    const years = await catalogAPI.getYears();
    console.log('✅ Years fetched:', Array.isArray(years) ? years.length : typeof years);
    res.json({ years });
  } catch (err) {
    console.error('❌ Years error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Get makes for a year
app.get('/api/catalog/makes/:year', async (req, res) => {
  try {
    const catalogAPI = await loadCatalogAPI();
    const makes = await catalogAPI.getMakes(req.params.year);
    res.json({ makes });
  } catch (err) {
    console.error('❌ Makes error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Get models for year + make
app.get('/api/catalog/models/:year/:make', async (req, res) => {
  try {
    const catalogAPI = await loadCatalogAPI();
    const models = await catalogAPI.getModels(req.params.year, req.params.make);
    res.json({ models });
  } catch (err) {
    console.error('❌ Models error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Get categories
app.get('/api/catalog/categories', async (req, res) => {
  try {
    const catalogAPI = await loadCatalogAPI();
    const categories = await catalogAPI.getCategories();
    res.json({ categories });
  } catch (err) {
    console.error('❌ Categories error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Search parts
app.post('/api/catalog/search', async (req, res) => {
  try {
    const { year, make, model, category, searchTerm } = req.body;
    const catalogAPI = await loadCatalogAPI();
    const parts = await catalogAPI.searchParts({ year, make, model, category, searchTerm });
    res.json({ parts });
  } catch (err) {
    console.error('❌ Search parts error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Add part to job
app.post('/api/catalog/add-part', async (req, res) => {
  try {
    const { jobId, partId, quantity, costPrice, sellPrice, shopId } = req.body;
    const catalogAPI = await loadCatalogAPI();
    const result = await catalogAPI.addPartToJob({ jobId, partId, quantity, costPrice, sellPrice, shopId });
    res.json(result);
  } catch (err) {
    console.error('❌ Add part error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Cron endpoint: auto-transition 'new' -> 'scheduled' for platform-created appointments older than 1 hour
app.post('/api/cron/auto-schedule', async (req, res) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Missing Supabase server credentials in env' });

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const cutoff = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago

    // Find appointments that are new, created before cutoff, and created by platform
    const { data: appts = [], error: fetchErr } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('status', 'new')
      .eq('source', 'platform')
      .lt('created_at', cutoff);

    if (fetchErr) {
      console.error('Cron fetch error:', fetchErr);
      return res.status(500).json({ error: 'Failed to fetch appointments', details: fetchErr });
    }

    // Only transition those that actually have a scheduled date/time
    const toTransition = appts.filter(a => (a.preferred_date || a.preferred_time));
    if (!toTransition.length) return res.json({ transitioned: 0 });

    const ids = toTransition.map(a => a.id);
    const now = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'scheduled', updated_at: now })
      .in('id', ids);

    if (updErr) {
      console.error('Cron update error (appointments):', updErr);
      return res.status(500).json({ error: 'Failed to update appointments', details: updErr });
    }

    // Also update the JSONB `data.appointments` for affected shops to keep data row consistent
    const shops = [...new Set(toTransition.map(a => a.shop_id))];
    for (const shopId of shops) {
      try {
        const { data: dataRow, error: dataErr } = await supabaseAdmin
          .from('data')
          .select('appointments')
          .eq('shop_id', shopId)
          .single();
        if (dataErr) {
          // Not fatal; continue
          console.warn('Failed to load data row for shop', shopId, dataErr);
          continue;
        }

        const apptsArr = dataRow?.appointments || [];
        let changed = false;
        const updatedAppts = apptsArr.map(a => {
          if (ids.includes(a.id) && a.status === 'new') {
            changed = true;
            return { ...a, status: 'scheduled', updated_at: now };
          }
          return a;
        });

        if (changed) {
          const { error: upsertErr } = await supabaseAdmin
            .from('data')
            .upsert({ shop_id: shopId, appointments: updatedAppts, updated_at: now }, { onConflict: 'shop_id' });
          if (upsertErr) console.warn('Failed to upsert data row for shop', shopId, upsertErr);
        }
      } catch (ex) {
        console.warn('Error updating data row for shop', shopId, ex);
      }
    }

    console.log(`Cron: transitioned ${ids.length} appointment(s) from new->scheduled`);
    return res.json({ transitioned: ids.length });
  } catch (err) {
    console.error('Cron exception:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Add labor to job
app.post('/api/catalog/add-labor', async (req, res) => {
  const { jobId, description, hours, rate, notes } = req.body;
  try {
    const result = await catalogAPI.addLaborToJob({ jobId, description, hours, rate, notes });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== MESSAGING / TWILIO API ROUTES =====
console.log('📱 Registering messaging API routes...');

// Provision a new Twilio number for a shop
app.post('/api/messaging/provision', messagingAPI.provisionNumber);

// Send an outbound message
app.post('/api/messaging/send', messagingAPI.sendMessage);

// Receive incoming messages from Twilio (webhook)
app.post('/api/messaging/webhook', express.urlencoded({ extended: false }), messagingAPI.receiveWebhook);

// Receive status callbacks from Twilio (delivery receipts)
app.post('/api/messaging/status', express.urlencoded({ extended: false }), messagingAPI.receiveStatusCallback);

// Get all threads for a shop
app.get('/api/messaging/threads/:shopId', messagingAPI.getThreads);

// Get all messages for a thread
app.get('/api/messaging/messages/:threadId', messagingAPI.getMessages);

// Release/deprovision a Twilio number
app.delete('/api/messaging/numbers/:numberId', messagingAPI.releaseNumber);

// Get parts for a job
app.get('/api/catalog/job-parts/:jobId', async (req, res) => {
  try {
    const parts = await catalogAPI.getJobParts(req.params.jobId);
    res.json({ parts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get labor for a job
app.get('/api/catalog/job-labor/:jobId', async (req, res) => {
  try {
    const labor = await catalogAPI.getJobLabor(req.params.jobId);
    console.log('[API] job-labor', req.params.jobId, 'rows:', Array.isArray(labor) ? labor.length : 'none', labor);
    res.json({ labor });
  } catch (error) {
    console.error('[API] job-labor error', req.params.jobId, error && error.message);
    res.status(500).json({ error: error.message });
  }
});

// Remove part from job
app.delete('/api/catalog/job-parts/:id', async (req, res) => {
  try {
    await catalogAPI.removeJobPart(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Xpose Management API LIVE. Use /api/* endpoints as documented.' });
});

// Serve static files LAST
app.use(express.static('.'));

// Export the Express app so a serverless wrapper in `/api` can import it.
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Xpose Management API on http://localhost:${PORT}`);
  });
} else {
  console.log('Running on Vercel - expect a serverless wrapper in /api');
}
