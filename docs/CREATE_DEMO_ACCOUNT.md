# Create Demo Account - Step by Step Guide

## Method 1: Supabase Dashboard (Easiest)

### Step 1: Create Auth User
1. Go to your Supabase Dashboard
2. Click **Authentication** → **Users**
3. Click **Add User** button
4. Fill in:
   - **Email**: `demo.barbershop@test.com`
   - **Password**: `Demo123456!`
   - **Auto Confirm User**: ✅ YES (important!)
5. Click **Create User**
6. **Copy the User ID** (looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

### Step 2: Create Shop
1. Go to **Table Editor** → **shops**
2. Click **Insert** → **Insert row**
3. Fill in these fields:

```
name: Style & Cuts Barbershop
type: Hair Salon
industry_type: barbershop          ⭐ KEY FIELD
email: demo.barbershop@test.com
zipcode: 21701
street: 123 Main St
city: Frederick
state: MD
join_code: DEMO01
staff_limit: 10
owner_id: [PASTE USER ID FROM STEP 1]
```

4. Click **Save**
5. **Copy the Shop ID** that was generated

### Step 3: Create User Record
1. Go to **Table Editor** → **users**
2. Click **Insert** → **Insert row**
3. Fill in these fields:

```
id: [PASTE USER ID FROM STEP 1]
auth_id: [PASTE USER ID FROM STEP 1]
email: demo.barbershop@test.com
first: Demo
last: User
role: admin
shop_id: [PASTE SHOP ID FROM STEP 2]
zipcode: 21701
subscription_plan: single
subscription_status: active
```

4. Click **Save**

### Step 4: Initialize Shop Data
1. Go to **Table Editor** → **data**
2. Click **Insert** → **Insert row**
3. Fill in these fields:

```
shop_id: [PASTE SHOP ID FROM STEP 2]
settings: {}
appointments: []
jobs: []
threads: []
invoices: []
```

4. Click **Save**

### Step 5: Login!
Go to your login page and sign in with:
- **Email**: `demo.barbershop@test.com`
- **Password**: `Demo123456!`

---

## Method 2: SQL Editor (Faster)

### Part A: Create Auth User First
1. Go to **Authentication** → **Users** → **Add User** (same as Method 1, Step 1)
2. Copy the User ID

### Part B: Run This SQL
1. Go to **SQL Editor**
2. Create new query
3. **Replace `YOUR_USER_ID_HERE`** with the actual UUID from Part A
4. **Run this SQL**:

```sql
-- Set your user ID here
DO $$
DECLARE
  v_user_id UUID := 'YOUR_USER_ID_HERE'; -- ⚠️ REPLACE THIS
  v_shop_id UUID;
BEGIN
  -- Create shop
  INSERT INTO shops (name, type, industry_type, email, zipcode, street, city, state, join_code, staff_limit, owner_id)
  VALUES (
    'Style & Cuts Barbershop',
    'Hair Salon',
    'barbershop',
    'demo.barbershop@test.com',
    '21701',
    '123 Main St',
    'Frederick',
    'MD',
    'DEMO01',
    10,
    v_user_id
  )
  RETURNING id INTO v_shop_id;
  
  -- Create user record
  INSERT INTO users (id, auth_id, email, first, last, role, shop_id, zipcode, subscription_plan, subscription_status)
  VALUES (v_user_id, v_user_id, 'demo.barbershop@test.com', 'Demo', 'User', 'admin', v_shop_id, '21701', 'single', 'active');
  
  -- Initialize data
  INSERT INTO data (shop_id, settings, appointments, jobs, threads, invoices)
  VALUES (v_shop_id, '{}', '[]', '[]', '[]', '[]');
  
  RAISE NOTICE 'Success! Shop ID: %', v_shop_id;
END $$;
```

---

## Create Different Industry Types

### Tattoo Studio
Change `industry_type` field to:
```
industry_type: tattoo_studio
name: Ink Masters Studio
type: Custom Tattoos
email: demo.tattoo@test.com
```

### Nail Salon
```
industry_type: nail_salon
name: Glamour Nails & Spa
type: Full Service
email: demo.nails@test.com
```

### Auto Shop (for comparison)
```
industry_type: auto_shop
name: Quick Fix Auto
type: Mechanic
email: demo.auto@test.com
```

---

## Verify It Worked

### Check in Database:
```sql
-- View your demo shops
SELECT id, name, industry_type, owner_id 
FROM shops 
WHERE email LIKE 'demo.%'
ORDER BY created_at DESC;

-- Check user record
SELECT id, email, role, shop_id, subscription_plan
FROM users
WHERE email LIKE 'demo.%';
```

### Expected Output:
- Shop should have `industry_type` = 'barbershop' (or whatever you chose)
- User should have `role` = 'admin'
- User's `shop_id` should match the shop's `id`
- Shop's `owner_id` should match the user's `id`

---

## Troubleshooting

**Can't login?**
- Make sure you clicked "Auto Confirm User" when creating auth user
- Or run: `UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = 'demo.barbershop@test.com';`

**"Shop not found"?**
- Verify shop_id in users table matches an actual shop id
- Run: `SELECT * FROM users WHERE email = 'demo.barbershop@test.com';`
- Compare shop_id with: `SELECT id FROM shops WHERE email = 'demo.barbershop@test.com';`

**Industry type not showing?**
- Make sure you ran the migration: `migrations/add_industry_type.sql`
- Verify column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'industry_type';`

---

## Quick Reset (Delete Demo Account)

```sql
-- Delete in reverse order to avoid foreign key issues
DELETE FROM data WHERE shop_id IN (SELECT id FROM shops WHERE email LIKE 'demo.%');
DELETE FROM users WHERE email LIKE 'demo.%';
DELETE FROM shops WHERE email LIKE 'demo.%';
-- Then manually delete from Authentication > Users in dashboard
```
