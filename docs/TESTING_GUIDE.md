# Multi-Industry Implementation - Testing Guide

## What Was Just Implemented

### Files Modified:
1. **`app.js`**
   - Added industry config imports
   - Added `initializeIndustryConfig()` function to load shop and initialize config
   - Added `updateNavigationTerminology()` function to update nav labels
   - Calls `initializeIndustryConfig()` before each page loads

2. **`pages/dashboard.js`**
   - Added industry config imports
   - Added `updateDashboardTerminology()` function to update labels
   - Loads shop data and calls `initializeShopConfig()` on dashboard load
   - Updates terminology for:
     - Quick create buttons
     - Sidebar headers
     - KPI labels
     - Day table headers
     - Job/appointment dropdowns

## What Should Happen Now

### For Your Barbershop:

**Navigation should show:**
- ✅ Dashboard
- ✅ **Appointments** (was "Appointments")
- ✅ **Appointments** (from "Jobs" - should say "Appointments")
- ✅ Messages
- ✅ Invoices
- ✅ **Clients** (was "Customers")
- ✅ Revenue
- ✅ Inventory (still visible)
- ✅ Settings
- ✅ Profile

**Dashboard should show:**
- ✅ "Active **Appointments**" (not "Active Jobs")
- ✅ "+ **Appointment**" button (not "+ Appointment")
- ✅ "+ **Client**" button (not "+ Customer")
- ✅ KPI showing "Active **appointments**"
- ✅ Day table: "**Client**" column (not "Customer")
- ✅ Day table: **Vehicle column hidden** (for barbershops)

## How to Test

### Step 1: Clear Cache
```javascript
// In browser console:
sessionStorage.clear();
```

### Step 2: Reload Dashboard
1. Logout
2. Login again
3. Go to dashboard

### Step 3: Check Console
You should see these log messages:
```
🏗️ Initializing industry configuration...
🏪 Shop loaded: [Your Shop Name] | Industry: barbershop
✅ Industry config initialized
🧭 Updating navigation terminology...
✅ Jobs → Appointments
✅ Appointments → Appointments  
✅ Customers → Clients
✅ Navigation terminology updated
📊 Setting up Dashboard...
🏷️ Updating dashboard terminology...
✅ Dashboard terminology updated
```

### Step 4: Visual Check
- [ ] Nav bar says "Appointments" (not "Jobs")
- [ ] Nav bar says "Clients" (not "Customers")
- [ ] Dashboard has "Active Appointments" sidebar
- [ ] Quick create button says "+ Appointment"
- [ ] Quick create button says "+ Client"
- [ ] Day table has "Client" column (not "Customer")
- [ ] Day table does NOT show "Vehicle" column

## Testing Different Industries

### Switch to Auto Shop:
```sql
UPDATE shops SET industry_type = 'auto_shop' WHERE id = 'your-shop-id';
```
Reload → Should see "Jobs", "Customers", vehicle columns

### Switch to Tattoo Studio:
```sql
UPDATE shops SET industry_type = 'tattoo_studio' WHERE id = 'your-shop-id';
```
Reload → Should see "Sessions", "Clients", no vehicles

### Switch to Nail Salon:
```sql
UPDATE shops SET industry_type = 'nail_salon' WHERE id = 'your-shop-id';
```
Reload → Should see "Appointments", "Clients", no vehicles

## Debugging

### If terminology doesn't change:

1. **Check config is loading:**
```javascript
// In browser console on dashboard:
const config = JSON.parse(sessionStorage.getItem('xm_shop_config'));
console.log(config);
```

Should show:
```javascript
{
  name: "Barbershop / Salon",
  icon: "✂️",
  terminology: {
    job: "Appointment",
    jobs: "Appointments",
    client: "Client",
    ...
  }
}
```

2. **Check industry type:**
```javascript
console.log(sessionStorage.getItem('xm_industry_type'));
// Should show: "barbershop"
```

3. **Manually test terminology:**
```javascript
import { getCurrentTerm } from './helpers/shop-config-loader.js';
console.log(getCurrentTerm('job'));      // Should show: "Appointment"
console.log(getCurrentTerm('jobs'));     // Should show: "Appointments"
console.log(getCurrentTerm('client'));   // Should show: "Client"
console.log(getCurrentTerm('clients'));  // Should show: "Clients"
```

### If nothing happens:

1. Make sure migration ran:
```sql
SELECT industry_type FROM shops WHERE id = 'your-shop-id';
```

2. Check browser console for errors

3. Clear all cache and reload:
```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```

## Known Limitations (For Now)

These pages haven't been updated yet:
- ❌ Jobs page (still says "Jobs" internally)
- ❌ Appointments page (needs terminology updates)
- ❌ Customers page (needs terminology updates)
- ❌ Invoices page (needs terminology updates)

These will be updated in the next phase!

## Success Criteria

✅ Navigation labels change based on industry
✅ Dashboard labels change based on industry
✅ Console shows industry config loading
✅ SessionStorage has config cached
✅ Different industries show different terms
✅ Vehicle column hides for non-auto industries
