# Quick Setup Guide - Multi-Industry Support

## Step 1: Run Database Migration

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Create new query
4. Copy and paste from `migrations/add_industry_type.sql`
5. Run the query

**Migration adds:**
- `industry_type` column (TEXT, default: 'auto_shop')
- Index for faster queries
- Check constraint for valid values
- Sets all existing shops to 'auto_shop'

## Step 2: Test Shop Creation

1. Go to `/create-shop.html`
2. You should now see **two dropdowns**:
   - **Industry Type**: Auto Shop, Barbershop, Tattoo Studio, Nail Salon, Other
   - **Shop Specialization**: Only shows when "Auto Shop" is selected

3. Test creating a shop:
   - Select "Barbershop / Salon"
   - Notice "Shop Specialization" disappears
   - Complete the form and create shop
   - Check database: `industry_type` should be 'barbershop'

## Step 3: Verify in Database

```sql
-- Check that industry_type column exists
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'shops' AND column_name = 'industry_type';

-- View all shops with their industry types
SELECT id, name, type, industry_type 
FROM shops 
ORDER BY created_at DESC;

-- Test different industry types
SELECT industry_type, COUNT(*) 
FROM shops 
GROUP BY industry_type;
```

## Step 4: Update Your Dashboard (Next Phase)

When you're ready to update pages to use industry-specific terminology:

```javascript
// In dashboard.js or any page
import { 
  initializeShopConfig,
  getCurrentTerm,
  hasCurrentFeature,
  currentUsesVehicles
} from './helpers/shop-config-loader.js';

// After loading shop data:
async function loadShop() {
  const shopData = await supabase.from('shops').select('*').single();
  
  // Initialize config
  initializeShopConfig(shopData.data);
  
  // Now use industry-specific terms
  const jobLabel = getCurrentTerm('job'); // "Job", "Appointment", or "Session"
  document.getElementById('jobsTitle').textContent = jobLabel + 's';
  
  // Hide/show features
  if (!currentUsesVehicles()) {
    document.getElementById('vehiclesNav').style.display = 'none';
  }
}
```

## What Works Now:

✅ Shop creation with industry selection
✅ Industry type stored in database
✅ Google OAuth preserves industry selection
✅ Auto shop specialization only shows for auto shops
✅ Industry configuration system ready to use
✅ Helper functions for terminology and features

## What's Next:

🔲 Update dashboard to load industry config
🔲 Update jobs page to use industry terms
🔲 Update clients/vehicles page based on industry
🔲 Update navigation labels
🔲 Build appointment calendar view
🔲 Add industry-specific features

## Quick Test Checklist:

- [ ] Database migration successful
- [ ] Create new auto shop - should work normally
- [ ] Create new barbershop - `industry_type` = 'barbershop'
- [ ] Create new tattoo studio - `industry_type` = 'tattoo_studio'
- [ ] Google OAuth works with industry selection
- [ ] Specialization dropdown hides for non-auto industries
- [ ] All existing shops have `industry_type` = 'auto_shop'

## Rollback (if needed):

```sql
-- Remove industry_type column
ALTER TABLE shops DROP COLUMN IF EXISTS industry_type;
```

---

Ready to continue? Let me know when you've run the migration and I can help update the dashboard and other pages to use the industry configuration!
