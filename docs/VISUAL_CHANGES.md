# Visual Changes Reference

## Shop Creation Form - Before vs After

### BEFORE:
```
┌─────────────────────────────────────┐
│  Shop Name: [____________]          │
│  Shop Type: [Mechanic ▼]            │  ← Only one dropdown
│             [Body      ]            │
│             [Other     ]            │
└─────────────────────────────────────┘
```

### AFTER:
```
┌─────────────────────────────────────┐
│  Shop Name: [____________]          │
│                                     │
│  Industry Type:                     │  ← NEW: Main selector
│  [Auto Shop              ▼]        │
│  [Barbershop / Salon     ]         │
│  [Tattoo & Piercing      ]         │
│  [Nail Salon / Spa       ]         │
│  [Other Service Business ]         │
│                                     │
│  Shop Specialization:               │  ← Only shows for auto shops
│  [Mechanic      ▼]                 │
│  [Body          ]                  │
│  [Performance   ]                  │
│  [General Repair]                  │
└─────────────────────────────────────┘
```

## Database Schema Changes

### BEFORE:
```
shops table:
├── id
├── name
├── type          ← "Mechanic", "Body", "Other"
├── email
├── zipcode
└── ...
```

### AFTER:
```
shops table:
├── id
├── name
├── type          ← Still "Mechanic", "Body", etc (specialization)
├── industry_type ← NEW: "auto_shop", "barbershop", "tattoo_studio", etc
├── email
├── zipcode
└── ...
```

## UI Terminology Changes by Industry

### Auto Shop (default - no changes)
```
Navigation:
- 🏠 Dashboard
- 🔧 Jobs
- 👥 Customers
- 🚗 Vehicles
- 📦 Parts
- 👔 Staff
- 💰 Invoices
```

### Barbershop
```
Navigation:
- 🏠 Dashboard
- ✂️ Appointments    ← Changed from "Jobs"
- 👥 Clients        ← Changed from "Customers"
- 💼 Services       ← Changed from "Labor"
- 🛍️ Products       ← Changed from "Parts"
- 👔 Stylists       ← Changed from "Staff"
- 💰 Invoices
```

### Tattoo Studio
```
Navigation:
- 🏠 Dashboard
- 🖊️ Sessions       ← Changed from "Jobs"
- 👥 Clients        ← Changed from "Customers"
- 🎨 Designs        ← New feature
- 💵 Deposits       ← New feature
- 👔 Artists        ← Changed from "Staff"
- 💰 Invoices
```

### Nail Salon
```
Navigation:
- 🏠 Dashboard
- 💅 Appointments    ← Changed from "Jobs"
- 👥 Clients        ← Changed from "Customers"
- 💼 Services       ← Changed from "Labor"
- 🛍️ Products       ← Changed from "Parts"
- 👔 Technicians    ← Changed from "Staff"
- 💰 Invoices
```

## Feature Matrix

| Feature              | Auto Shop | Barbershop | Tattoo | Nail Salon |
|---------------------|-----------|------------|--------|------------|
| Vehicles            | ✅        | ❌         | ❌     | ❌         |
| VIN Lookup          | ✅        | ❌         | ❌     | ❌         |
| Mileage Tracking    | ✅        | ❌         | ❌     | ❌         |
| Parts Inventory     | ✅        | ✅*        | ✅*    | ✅*        |
| Service Duration    | ❌        | ✅         | ✅     | ✅         |
| Appointments        | ✅        | ✅         | ✅     | ✅         |
| Recurring Appts     | ❌        | ✅         | ❌     | ✅         |
| Deposits            | ❌        | ❌         | ✅     | ❌         |
| Design Gallery      | ❌        | ❌         | ✅     | ❌         |
| Service Packages    | ❌        | ❌         | ❌     | ✅         |
| Messaging           | ✅        | ✅         | ✅     | ✅         |
| Invoicing           | ✅        | ✅         | ✅     | ✅         |
| Estimates           | ✅        | ❌         | ✅     | ❌         |

*Inventory renamed to "Retail Products" or "Aftercare Products"

## Job/Appointment Form Changes

### Auto Shop (current):
```
Create Job:
├── Select Vehicle
├── Mileage In
├── Diagnosis
├── Parts
├── Labor
└── Estimate
```

### Barbershop:
```
Create Appointment:
├── Select Client      ← No vehicle
├── Select Stylist
├── Service Type
├── Duration
└── Notes
```

### Tattoo Studio:
```
Create Session:
├── Select Client      ← No vehicle
├── Select Artist
├── Design Type
├── Placement
├── Size/Hours
├── Deposit Required
└── Total Sessions
```

## Code Example: Feature Detection

```javascript
// Auto Shop
if (hasCurrentFeature('vehicles')) {
  // Show: Vehicle selector, VIN lookup, mileage
}

// Barbershop
if (hasCurrentFeature('service_duration')) {
  // Show: Duration picker, time slots
}

// Tattoo Studio
if (hasCurrentFeature('deposits')) {
  // Show: Deposit amount, deposit status
}

if (hasCurrentFeature('design_gallery')) {
  // Show: Design upload, gallery view
}
```

## Migration Impact

### Existing Shops (Auto Shops):
- ✅ No breaking changes
- ✅ Automatically set to `industry_type: 'auto_shop'`
- ✅ All features continue working
- ✅ UI looks exactly the same

### New Shops:
- ✅ Choose industry during creation
- ✅ UI adapts to selected industry
- ✅ Only relevant features shown
- ✅ Industry-specific terminology
