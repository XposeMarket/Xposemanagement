# Multi-Industry Support Implementation

## Overview
Xpose Management has been updated to support multiple service industries beyond auto shops, including barbershops, tattoo studios, nail salons, and other service-based businesses.

## What Changed

### 1. Database Schema
- Added `industry_type` column to `shops` table
- Migration file: `migrations/add_industry_type.sql`
- Run this migration in Supabase SQL Editor:
  ```sql
  -- Copy and paste the contents of migrations/add_industry_type.sql
  ```

### 2. Shop Creation Flow
**Updated Files:**
- `create-shop.html` - Added industry type dropdown
- `pages/create-shop.js` - Captures and stores industry type

**New Fields:**
- `Industry Type` - Main selector (auto_shop, barbershop, tattoo_studio, nail_salon, other)
- `Shop Specialization` - Only shows for auto shops (Mechanic, Body, Performance, General)

### 3. Industry Configuration System
**New Files:**
- `helpers/industry-config.js` - Configuration for all supported industries
- `helpers/shop-config-loader.js` - Runtime configuration loader

**Features per Industry:**

#### Auto Shop (default)
- ✅ Vehicles
- ✅ Parts inventory
- ✅ VIN lookup
- ✅ Mileage tracking
- ✅ Estimates
- Terms: Jobs, Customers, Parts, Labor, Technicians

#### Barbershop/Salon
- ❌ No vehicles
- ✅ Service scheduling
- ✅ Retail products
- ✅ Recurring appointments
- Terms: Appointments, Clients, Services, Stylists

#### Tattoo Studio
- ❌ No vehicles
- ✅ Session tracking
- ✅ Deposits
- ✅ Design gallery
- Terms: Sessions, Clients, Bookings, Artists

#### Nail Salon/Spa
- ❌ No vehicles
- ✅ Service packages
- ✅ Product retail
- ✅ Recurring appointments
- Terms: Appointments, Clients, Services, Technicians

## Using Industry Configuration

### In Your Code

```javascript
import { 
  initializeShopConfig, 
  getCurrentTerm, 
  hasCurrentFeature,
  currentUsesVehicles 
} from './helpers/shop-config-loader.js';

// Initialize when loading shop data
const shopData = await loadShopData();
initializeShopConfig(shopData);

// Use industry-specific terminology
const jobTerm = getCurrentTerm('job'); // Returns "Job", "Appointment", or "Session"
const clientTerm = getCurrentTerm('client'); // Returns "Customer" or "Client"

// Check if features are available
if (hasCurrentFeature('vehicles')) {
  // Show vehicle-related UI
}

if (hasCurrentFeature('deposits')) {
  // Show deposit tracking
}

// Conditional rendering
if (currentUsesVehicles()) {
  showVehicleSelector();
} else {
  showClientSelector();
}
```

### Updating Existing Pages

To make existing pages work with multiple industries:

1. **Import configuration helpers:**
```javascript
import { 
  getCurrentTerm, 
  hasCurrentFeature, 
  updatePageTerminology 
} from './helpers/shop-config-loader.js';
```

2. **Update terminology on page load:**
```javascript
document.addEventListener('DOMContentLoaded', () => {
  updatePageTerminology(); // Automatically updates common terms
});
```

3. **Use feature flags:**
```javascript
// Show/hide sections based on industry
document.getElementById('vehicleSection').style.display = 
  hasCurrentFeature('vehicles') ? 'block' : 'none';
  
document.getElementById('depositsSection').style.display = 
  hasCurrentFeature('deposits') ? 'block' : 'none';
```

## Next Steps

### Priority Pages to Update:
1. **Dashboard** - Show relevant metrics per industry
2. **Jobs Page** - Rename based on industry (Jobs/Appointments/Sessions)
3. **Clients/Vehicles Page** - Show vehicles OR direct client management
4. **Invoices** - Already generic, but terminology needs updating
5. **Staff Page** - Update terminology (Technicians/Stylists/Artists)
6. **Settings** - Add industry-specific settings sections

### Features to Build:
- [ ] Appointment calendar view (for non-auto industries)
- [ ] Service duration tracking
- [ ] Deposit management (tattoo studios)
- [ ] Design gallery (tattoo studios)
- [ ] Service packages (nail salons)
- [ ] Recurring appointments
- [ ] Client-only management (no vehicles)

## Testing

### Test Shop Creation:
1. Create shops with different industry types
2. Verify `industry_type` is saved correctly in database
3. Check that shop specialization only shows for auto shops
4. Confirm all industry types work with Google OAuth

### Test Industry Configuration:
```javascript
// In browser console after shop is loaded
import { getCurrentConfig } from './helpers/shop-config-loader.js';
console.log(getCurrentConfig());
```

## Backward Compatibility

All existing auto shops will be automatically set to `industry_type: 'auto_shop'` during migration. The platform remains fully functional for existing shops without any changes needed.

## Notes

- Industry type is set at shop creation and stored in the database
- Configuration is loaded per-session and cached
- UI terminology updates automatically based on industry
- Feature availability is determined by industry type
- All existing functionality for auto shops remains unchanged
