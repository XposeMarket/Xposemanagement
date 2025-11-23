-- Minimal SQL for the CRM app
-- Run these in the Supabase SQL editor (or via psql) for your project.

-- 1) shops table
create table if not exists public.shops (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text,
  logo text,
  join_code text,
  staff_limit int default 3,
  created_at timestamptz default now()
);

-- 2) users (app metadata) - note: auth.users is the auth table; we keep lightweight app metadata here
create table if not exists public.users (
  id uuid primary key, -- should match auth.users.id
  auth_id uuid unique not null, -- reference to auth.users.id
  first text,
  last text,
  email text,
  zipcode text,
  role text,
  shop_id uuid references public.shops(id) on delete set null,
  created_at timestamptz default now()
);

-- Add auth_id column if it doesn't exist (for existing databases)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='users' AND column_name='auth_id') THEN
    ALTER TABLE public.users ADD COLUMN auth_id uuid unique;
  END IF;
END $$;

-- 3) data (per-shop JSON blob). You can store the app's big JSON object here.
create table if not exists public.data (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  settings jsonb,
  appointments jsonb,
  jobs jsonb,
  threads jsonb,
  invoices jsonb,
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_shops_join_code on public.shops(lower(join_code));
create index if not exists idx_users_auth_id on public.users(auth_id);
create index if not exists idx_users_shop_id on public.users(shop_id);

-- Row-Level Security examples (enable RLS and add policies) -----------------
-- Enable RLS on each table when you are ready for production
-- Example for `shops`: allow select where user is member of the shop (via users table)

-- enable RLS
-- alter table public.shops enable row level security;
-- alter table public.users enable row level security;
-- alter table public.data enable row level security;

-- Policy: allow a logged-in user to select shops where they are a member (via public.users)
-- create policy "select_shop_if_member" on public.shops
--   for select using (
--     exists (select 1 from public.users u where u.auth_id = auth.uid() and u.shop_id = public.shops.id)
--   );

-- Policy: allow a logged-in user to manage their own metadata row
-- create policy "user_is_owner" on public.users
--   for all using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- Policy: allow shop members to read/write their shop data
-- create policy "shop_members_read_write_data" on public.data
--   for all using (
--     exists (select 1 from public.users u where u.auth_id = auth.uid() and u.shop_id = public.data.shop_id)
--   ) with check (
--     exists (select 1 from public.users u where u.auth_id = auth.uid() and u.shop_id = public.data.shop_id)
--   );

-- NOTE: The policies above are templates. Adapt them to your security model and test thoroughly.
