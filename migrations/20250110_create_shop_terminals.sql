-- Migration: Create shop_terminals table for additional terminals
-- Run this in your Supabase SQL editor

-- Create the shop_terminals table
CREATE TABLE IF NOT EXISTS public.shop_terminals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  terminal_model TEXT NOT NULL, -- 'wisepos_e' or 'reader_s700'
  terminal_serial TEXT, -- Serial number once assigned
  terminal_id TEXT, -- Stripe terminal ID once registered
  stripe_subscription_id TEXT, -- The subscription ID for this terminal
  status TEXT DEFAULT 'pending_shipment', -- 'pending_shipment', 'shipped', 'active', 'inactive'
  label TEXT, -- Custom label for this terminal
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  shipped_at TIMESTAMP WITH TIME ZONE,
  activated_at TIMESTAMP WITH TIME ZONE
);

-- Create index for faster lookups by shop
CREATE INDEX IF NOT EXISTS idx_shop_terminals_shop_id ON public.shop_terminals(shop_id);

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_shop_terminals_status ON public.shop_terminals(status);

-- Add RLS policies
ALTER TABLE public.shop_terminals ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view terminals for their shop
CREATE POLICY "Users can view own shop terminals" ON public.shop_terminals
  FOR SELECT
  USING (
    shop_id IN (
      SELECT shop_id FROM public.users WHERE id = auth.uid()
      UNION
      SELECT shop_id FROM public.shop_staff WHERE auth_id = auth.uid()
    )
  );

-- Policy: Admins can insert terminals for their shop
CREATE POLICY "Admins can insert terminals" ON public.shop_terminals
  FOR INSERT
  WITH CHECK (
    shop_id IN (
      SELECT shop_id FROM public.users WHERE id = auth.uid() AND role = 'admin'
      UNION
      SELECT shop_id FROM public.shop_staff WHERE auth_id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Admins can update terminals for their shop
CREATE POLICY "Admins can update terminals" ON public.shop_terminals
  FOR UPDATE
  USING (
    shop_id IN (
      SELECT shop_id FROM public.users WHERE id = auth.uid() AND role = 'admin'
      UNION
      SELECT shop_id FROM public.shop_staff WHERE auth_id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Service role can do anything (for backend API)
CREATE POLICY "Service role full access" ON public.shop_terminals
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_shop_terminals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shop_terminals_updated_at
  BEFORE UPDATE ON public.shop_terminals
  FOR EACH ROW
  EXECUTE FUNCTION update_shop_terminals_updated_at();

-- Grant permissions
GRANT ALL ON public.shop_terminals TO authenticated;
GRANT ALL ON public.shop_terminals TO service_role;

COMMENT ON TABLE public.shop_terminals IS 'Stores additional terminals purchased for shop locations';
COMMENT ON COLUMN public.shop_terminals.terminal_model IS 'Terminal model: wisepos_e or reader_s700';
COMMENT ON COLUMN public.shop_terminals.status IS 'Terminal status: pending_shipment, shipped, active, inactive';
