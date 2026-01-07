# Quick Convert Existing Shop to Different Industry

## Super Simple Version

### Step 1: Find Your Shop
```sql
SELECT id, name, industry_type FROM shops;
```

Copy the `id` of the shop you want to convert.

### Step 2: Convert It
Replace `YOUR_SHOP_ID` with the actual UUID:

```sql
-- Convert to Barbershop
UPDATE shops 
SET industry_type = 'barbershop' 
WHERE id = 'YOUR_SHOP_ID';
```

### Step 3: Verify
```sql
SELECT id, name, industry_type FROM shops WHERE id = 'YOUR_SHOP_ID';
```

Should show: `industry_type: barbershop`

### Step 4: Reload Dashboard
1. Logout if you're logged in
2. Login again
3. Dashboard should now adapt to barbershop mode

---

## One-Liner Conversions

```sql
-- Barbershop
UPDATE shops SET industry_type = 'barbershop' WHERE id = 'YOUR_SHOP_ID';

-- Tattoo Studio  
UPDATE shops SET industry_type = 'tattoo_studio' WHERE id = 'YOUR_SHOP_ID';

-- Nail Salon
UPDATE shops SET industry_type = 'nail_salon' WHERE id = 'YOUR_SHOP_ID';

-- Back to Auto Shop
UPDATE shops SET industry_type = 'auto_shop' WHERE id = 'YOUR_SHOP_ID';
```

---

## Example with Real IDs

If your shop ID is `abc123-def456-789`:

```sql
UPDATE shops 
SET industry_type = 'barbershop' 
WHERE id = 'abc123-def456-789';
```

Done! 🎉

---

## Notes

- ✅ All existing data preserved (jobs, invoices, customers, vehicles)
- ✅ Can switch back anytime
- ✅ Takes effect on next login/page reload
- ⚠️ Make sure you ran `add_industry_type.sql` migration first
