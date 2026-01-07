# Developer Quick Reference - Multi-Industry Support

## Import Statements

```javascript
// Industry configuration
import { 
  getIndustryConfig,
  getTerm,
  hasFeature,
  usesVehicles,
  getPrimaryEntity,
  getDefaultServices
} from './helpers/industry-config.js';

// Shop-specific helpers (use these most often)
import { 
  initializeShopConfig,
  getCurrentTerm,
  hasCurrentFeature,
  currentUsesVehicles,
  updatePageTerminology,
  clearShopConfig
} from './helpers/shop-config-loader.js';
```

## Common Patterns

### Initialize on Shop Load
```javascript
async function loadShop() {
  const { data: shop } = await supabase
    .from('shops')
    .select('*')
    .eq('id', shopId)
    .single();
  
  // Initialize config for this shop
  initializeShopConfig(shop);
  
  // Now all helper functions work
  console.log(`Industry: ${shop.industry_type}`);
  console.log(`Uses vehicles: ${currentUsesVehicles()}`);
}
```

### Update Page Terminology
```javascript
document.addEventListener('DOMContentLoaded', () => {
  // Load shop config first
  initializeShopConfig(shopData);
  
  // Auto-update common terms on page
  updatePageTerminology();
  
  // Manual updates for specific elements
  document.getElementById('pageTitle').textContent = 
    getCurrentTerm('jobs'); // "Jobs", "Appointments", or "Sessions"
});
```

### Show/Hide Based on Features
```javascript
// Hide vehicle section for non-auto industries
if (!currentUsesVehicles()) {
  document.getElementById('vehicleSection').style.display = 'none';
  document.getElementById('clientSection').style.display = 'block';
}

// Show deposits for tattoo studios
if (hasCurrentFeature('deposits')) {
  document.getElementById('depositSection').style.display = 'block';
}

// Show design gallery for tattoo studios
if (hasCurrentFeature('design_gallery')) {
  document.getElementById('designGallery').style.display = 'block';
}
```

### Dynamic Labels
```javascript
// Button labels
const addButton = document.getElementById('addButton');
addButton.textContent = `Add ${getCurrentTerm('job')}`; 
// Auto Shop: "Add Job"
// Barbershop: "Add Appointment"
// Tattoo: "Add Session"

// Table headers
const tableHeader = document.querySelector('th');
tableHeader.textContent = getCurrentTerm('jobs');
// Auto Shop: "Jobs"
// Barbershop: "Appointments"
// Tattoo: "Sessions"
```

### Conditional Form Fields
```javascript
const form = document.getElementById('jobForm');

if (currentUsesVehicles()) {
  // Auto shop - show vehicle fields
  form.innerHTML += `
    <label>Vehicle</label>
    <select id="vehicle"></select>
    <label>Mileage In</label>
    <input type="number" id="mileageIn">
  `;
} else {
  // Service industry - show direct client fields
  form.innerHTML += `
    <label>${getCurrentTerm('client')}</label>
    <select id="client"></select>
    <label>Service Type</label>
    <select id="serviceType"></select>
  `;
}
```

## Terminology Mapping

| Generic Term | Auto Shop | Barbershop | Tattoo Studio | Nail Salon |
|--------------|-----------|------------|---------------|------------|
| job          | Job       | Appointment| Session       | Appointment|
| jobs         | Jobs      | Appointments| Sessions     | Appointments|
| client       | Customer  | Client     | Client        | Client     |
| clients      | Customers | Clients    | Clients       | Clients    |
| service      | Labor     | Service    | Service       | Service    |
| services     | Labor Items| Services  | Services      | Services   |
| product      | Part      | Product    | Aftercare Product| Product |
| products     | Parts     | Retail Products| Aftercare Products| Retail Products|
| staff        | Technician| Stylist    | Artist        | Technician |
| staffPlural  | Technicians| Stylists  | Artists       | Technicians|

## Feature Flags

```javascript
// Check before using features
hasCurrentFeature('vehicles')        // Auto shops only
hasCurrentFeature('vin_lookup')      // Auto shops only
hasCurrentFeature('mileage_tracking')// Auto shops only
hasCurrentFeature('parts_ordering')  // Auto shops only

hasCurrentFeature('service_duration')// Service industries
hasCurrentFeature('recurring_appointments') // Barbershops, nail salons
hasCurrentFeature('deposits')        // Tattoo studios only
hasCurrentFeature('design_gallery')  // Tattoo studios only
hasCurrentFeature('service_packages')// Nail salons only

hasCurrentFeature('inventory')       // All industries
hasCurrentFeature('scheduling')      // All industries
hasCurrentFeature('messaging')       // All industries
hasCurrentFeature('invoicing')       // All industries
hasCurrentFeature('estimates')       // Auto shops, tattoo studios
```

## Database Queries

### Get Shop with Industry
```javascript
const { data: shop } = await supabase
  .from('shops')
  .select('id, name, type, industry_type')
  .eq('id', shopId)
  .single();

console.log(shop.industry_type); // 'auto_shop', 'barbershop', etc.
```

### Filter by Industry
```javascript
// Get all barbershops
const { data: barbershops } = await supabase
  .from('shops')
  .select('*')
  .eq('industry_type', 'barbershop');
```

### Create Shop with Industry
```javascript
const { data: newShop } = await supabase
  .from('shops')
  .insert([{
    name: 'Style Studio',
    type: 'Hair', // Specialization (optional for non-auto)
    industry_type: 'barbershop', // Required
    email: 'info@stylestudio.com',
    zipcode: '12345'
  }])
  .select()
  .single();
```

## Default Services

```javascript
import { getDefaultServices } from './helpers/industry-config.js';

// Get default services for current shop
const services = getDefaultServices(shop.industry_type);

// Example for barbershop:
// [
//   { name: 'Haircut - Men', duration: 30, price: 25 },
//   { name: 'Haircut - Women', duration: 45, price: 40 },
//   { name: 'Beard Trim', duration: 15, price: 15 },
//   ...
// ]

// Populate service selector
services.forEach(service => {
  const option = document.createElement('option');
  option.value = service.name;
  option.textContent = `${service.name} - $${service.price} (${service.duration}min)`;
  serviceSelect.appendChild(option);
});
```

## Clear Config (on Logout/Shop Switch)

```javascript
function logout() {
  // Clear shop config
  clearShopConfig();
  
  // Clear other session data
  localStorage.removeItem('xm_session');
  sessionStorage.clear();
  
  // Redirect
  window.location.href = 'login.html';
}

function switchShop(newShopId) {
  // Clear old config
  clearShopConfig();
  
  // Load new shop
  const newShop = await loadShopData(newShopId);
  
  // Initialize new config
  initializeShopConfig(newShop);
  
  // Reload page
  location.reload();
}
```

## Error Handling

```javascript
// Always check if config is initialized
try {
  const term = getCurrentTerm('job');
} catch (error) {
  console.error('Shop config not initialized', error);
  // Fallback to generic term
  const term = 'Job';
}

// Or check manually
if (!sessionStorage.getItem('xm_industry_type')) {
  console.warn('Industry type not set, using default');
  initializeShopConfig({ industry_type: 'auto_shop' });
}
```

## Testing in Console

```javascript
// After page loads
import { getCurrentConfig } from './helpers/shop-config-loader.js';

// See full config
console.log(getCurrentConfig());

// Test terminology
console.log(getCurrentTerm('job'));
console.log(getCurrentTerm('client'));
console.log(getCurrentTerm('staff'));

// Test features
console.log(hasCurrentFeature('vehicles'));
console.log(hasCurrentFeature('deposits'));
console.log(currentUsesVehicles());
```

## Common Gotchas

❌ **Don't hardcode terms:**
```javascript
// Bad
document.title = 'Jobs';

// Good
document.title = getCurrentTerm('jobs');
```

❌ **Don't assume features exist:**
```javascript
// Bad
const vehicle = document.getElementById('vehicleSelect').value;

// Good
if (currentUsesVehicles()) {
  const vehicle = document.getElementById('vehicleSelect').value;
}
```

❌ **Don't forget to initialize:**
```javascript
// Bad
getCurrentTerm('job'); // Error if not initialized

// Good
initializeShopConfig(shopData);
getCurrentTerm('job'); // Works
```

✅ **Do initialize early:**
```javascript
// Good - initialize as soon as shop data loads
document.addEventListener('DOMContentLoaded', async () => {
  const shop = await loadShop();
  initializeShopConfig(shop); // Do this first
  updatePageTerminology();    // Then update UI
  renderContent();            // Then render
});
```
