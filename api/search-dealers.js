/**
 * Vercel Serverless Function: Search Dealers
 * Path: /api/search-dealers
 * 
 * Searches for dealerships using Google Programmable Search API
 * with aggressive caching to stay under free tier limits
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables (set these in Vercel dashboard)
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || 'AIzaSyAoepqAtWCIEcskpkSS22kD3TeQM7rDlJE';
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || '5783145ca815040ec';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { manufacturer, location, shopId } = req.body;

    if (!manufacturer || !location) {
      return res.status(400).json({ error: 'Missing manufacturer or location' });
    }

    // Initialize Supabase client with service role key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check cache first (30 day TTL)
    const cacheKey = `${manufacturer.toLowerCase()}-${location.toLowerCase()}`;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: cached, error: cacheError } = await supabase
      .from('dealership_search_cache')
      .select('results, cached_at')
      .eq('manufacturer', manufacturer.toLowerCase())
      .eq('location', location.toLowerCase())
      .gte('cached_at', thirtyDaysAgo)
      .single();

    if (cached && !cacheError) {
      console.log('✅ Cache hit for:', manufacturer, location);
      return res.status(200).json({
        results: cached.results,
        cached: true,
        cached_at: cached.cached_at
      });
    }

    console.log('🔍 Cache miss - calling Google API for:', manufacturer, location);

    // Build search query
    const query = `${manufacturer} dealership near ${location}`;
    
    // Call Google Programmable Search API
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5`;
    
    const response = await fetch(googleUrl);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Google API Error:', errorData);
      return res.status(response.status).json({ 
        error: 'Google search failed', 
        details: errorData 
      });
    }

    const data = await response.json();

    // Parse results into clean format
    const results = (data.items || []).map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      displayLink: item.displayLink
    }));

    // Save to cache
    const { error: insertError } = await supabase
      .from('dealership_search_cache')
      .upsert({
        manufacturer: manufacturer.toLowerCase(),
        location: location.toLowerCase(),
        results: results,
        cached_at: new Date().toISOString()
      }, {
        onConflict: 'manufacturer,location'
      });

    if (insertError) {
      console.warn('Failed to cache results:', insertError);
      // Continue anyway - cache failure shouldn't break the feature
    }

    console.log('✅ Google API call successful, cached results');

    return res.status(200).json({
      results: results,
      cached: false,
      search_query: query
    });

  } catch (error) {
    console.error('Search dealers error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};
