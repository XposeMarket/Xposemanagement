/**
 * Parts Catalog API Helper Functions
 * Connects to Supabase for parts catalog operations
 */

import { createClient } from '@supabase/supabase-js';

// Lazily initialize Supabase client. Creating the client at module load
// time can throw or produce hard-to-debug function failures when env
// variables are missing in serverless runtimes. Use `getSupabase()`
// inside route handlers so we can surface a clear error message.
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Supabase ENV ERROR:', {
      SUPABASE_URL,
      SUPABASE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
    });
    throw new Error('Missing Supabase env: require SUPABASE_URL and SUPABASE_KEY');
  }
  try {
    _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    console.error('Supabase client creation error:', err);
    throw err;
  }
  return _supabase;
}

/**
 * Get all available years (1990-2025)
 */
export async function getYears() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('catalog_vehicles')
    .select('year')
    .order('year', { ascending: false });

  if (error) throw error;
  
  // Return unique years
  const uniqueYears = [...new Set(data.map(v => v.year))];
  return uniqueYears;
}

/**
 * Get all makes for a specific year
 */
export async function getMakes(year) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('catalog_vehicles')
    .select('make')
    .eq('year', year)
    .order('make');

  if (error) throw error;
  
  // Return unique makes
  const uniqueMakes = [...new Set(data.map(v => v.make))];
  return uniqueMakes;
}

/**
 * Get all models for a year + make combination
 */
export async function getModels(year, make) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('catalog_vehicles')
    .select('model')
    .eq('year', year)
    .eq('make', make)
    .order('model');

  if (error) throw error;
  
  // Return unique models
  const uniqueModels = [...new Set(data.map(v => v.model))];
  return uniqueModels;
}

/**
 * Get all part categories
 */
export async function getCategories() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('catalog_categories')
    .select('*')
    .order('name');

  if (error) throw error;
  return data;
}

/**
 * Search parts with filters
 */
export async function searchParts({ year, make, model, category, searchTerm }) {
  const supabase = getSupabase();
  let query = supabase
    .from('catalog_parts')
    .select(`
      *,
      category:catalog_categories(name)
    `);

  // Filter by vehicle if provided
  if (year) query = query.eq('year', year);
  if (make) query = query.eq('make', make);
  if (model) query = query.eq('model', model);

  // Filter by category if provided
  if (category) query = query.eq('category_id', category);

  // Search by term if provided
  if (searchTerm) {
    query = query.or(`part_name.ilike.%${searchTerm}%,part_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
  }

  query = query.order('part_name');

  const { data, error } = await query;
  if (error) throw error;

  return data;
}

/**
 * Add a part to a job with pricing
 */
export async function addPartToJob({ jobId, partId, quantity, costPrice, sellPrice, shopId }) {
  // First get the part details
  const supabase = getSupabase();
  const { data: part, error: partError } = await supabase
    .from('catalog_parts')
    .select('*')
    .eq('id', partId)
    .single();

  if (partError) throw partError;

  // Calculate markup
  const markup = sellPrice && costPrice ? ((sellPrice - costPrice) / costPrice * 100).toFixed(2) : 0;

  // Insert into job_parts
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_parts')
    .insert({
      shop_id: shopId,
      job_id: jobId,
      part_id: partId,
      part_name: part.part_name,
      part_number: part.part_number,
      quantity: quantity || 1,
      cost_price: costPrice || 0,
      sell_price: sellPrice || 0,
      markup_percent: markup
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Get all parts for a specific job
 */
export async function getJobParts(jobId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_parts')
    .select(`
      *,
      part:catalog_parts(*)
    `)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Remove a part from a job
 */
export async function removeJobPart(jobPartId) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('job_parts')
    .delete()
    .eq('id', jobPartId);

  if (error) throw error;
  return { success: true };
}

/**
 * Update job part quantity or pricing
 */
export async function updateJobPart(jobPartId, updates) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_parts')
    .update(updates)
    .eq('id', jobPartId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Add labor to a job
 */
export async function addLaborToJob({ jobId, description, hours, rate, notes }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_labor')
    .insert({
      job_id: jobId,
      description,
      hours,
      rate,
      notes,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get all labor for a specific job
 */
export async function getJobLabor(jobId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_labor')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
