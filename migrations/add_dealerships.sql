-- Dealerships table (user's saved dealers per shop)
CREATE TABLE IF NOT EXISTS dealerships (
  id TEXT PRIMARY KEY DEFAULT ('dealer_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 8)),
  shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  website TEXT,
  phone TEXT,
  address TEXT,
  google_snippet TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_dealerships_shop_id ON dealerships(shop_id);
CREATE INDEX IF NOT EXISTS idx_dealerships_manufacturer ON dealerships(manufacturer);

-- Dealership search cache (global, shared across shops)
CREATE TABLE IF NOT EXISTS dealership_search_cache (
  id TEXT PRIMARY KEY DEFAULT ('cache_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 8)),
  manufacturer TEXT NOT NULL,
  location TEXT NOT NULL,
  results JSONB NOT NULL,
  cached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(manufacturer, location)
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_cache_lookup ON dealership_search_cache(manufacturer, location);

-- Row Level Security
ALTER TABLE dealerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealership_search_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their shop's dealerships
CREATE POLICY "Users can view their shop's dealerships"
  ON dealerships FOR SELECT
  USING (shop_id IN (
    SELECT shop_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can insert dealerships for their shop"
  ON dealerships FOR INSERT
  WITH CHECK (shop_id IN (
    SELECT shop_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can update their shop's dealerships"
  ON dealerships FOR UPDATE
  USING (shop_id IN (
    SELECT shop_id FROM users WHERE auth_id = auth.uid()
  ));

CREATE POLICY "Users can delete their shop's dealerships"
  ON dealerships FOR DELETE
  USING (shop_id IN (
    SELECT shop_id FROM users WHERE auth_id = auth.uid()
  ));

-- Cache is readable by everyone (it's shared data)
CREATE POLICY "Anyone can read cache"
  ON dealership_search_cache FOR SELECT
  USING (true);

-- Only service role can write cache (via API)
CREATE POLICY "Service role can manage cache"
  ON dealership_search_cache FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

COMMENT ON TABLE dealerships IS 'Saved dealerships per shop';
COMMENT ON TABLE dealership_search_cache IS 'Cached Google search results for dealerships by location';
