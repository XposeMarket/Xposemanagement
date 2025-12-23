# Terminal API Endpoints

## Overview

These endpoints handle Stripe Terminal integration for in-person payments.

All endpoints support **TEST_MODE** for development without a physical terminal.

---

## Endpoints

### 1. GET /api/terminal/status/:shopId

Check the status of a shop's registered terminal.

**Request:**
```bash
GET /api/terminal/status/YOUR_SHOP_ID
```

**Response (No Terminal):**
```json
{
  "status": "not_registered",
  "message": "No terminal registered for this shop"
}
```

**Response (Terminal Registered):**
```json
{
  "status": "online",
  "device_type": "bbpos_wisepos_e",
  "label": "Shop Terminal",
  "model": "wisepos_e",
  "serial": "WPE-12345",
  "action": null
}
```

**Test Mode:**
```bash
GET /api/terminal/status/YOUR_SHOP_ID?test=true
```

---

### 2. POST /api/terminal/register

Register a Stripe Terminal for a shop.

**Request:**
```bash
POST /api/terminal/register
Content-Type: application/json

{
  "shopId": "YOUR_SHOP_ID",
  "registrationCode": "ABCDE-12345"
}
```

**Response (Success):**
```json
{
  "success": true,
  "reader": {
    "id": "tmr_abc123",
    "serial": "WPE-12345",
    "status": "online",
    "device_type": "bbpos_wisepos_e"
  },
  "location": {
    "id": "tml_xyz789",
    "display_name": "My Shop"
  }
}
```

**Response (Already Registered):**
```json
{
  "error": "Shop already has a registered terminal",
  "existing_terminal_id": "tmr_abc123"
}
```

**Test Mode:**
```bash
POST /api/terminal/register?test=true
# Will create mock terminal without hitting Stripe
```

---

### 3. POST /api/terminal/create-payment

Create a payment and send to terminal for processing.

**Request:**
```bash
POST /api/terminal/create-payment
Content-Type: application/json

{
  "invoiceId": "invoice-uuid-here",
  "shopId": "YOUR_SHOP_ID"
}
```

**Response (Success):**
```json
{
  "success": true,
  "paymentIntent": "pi_abc123",
  "amount": 10500,
  "terminal_id": "tmr_abc123",
  "message": "Payment sent to terminal"
}
```

**Response (No Terminal):**
```json
{
  "error": "No terminal registered for this shop"
}
```

**Test Mode:**
```bash
POST /api/terminal/create-payment?test=true
# Will automatically mark invoice as paid without Stripe
```

---

## Environment Variables

Required in your `.env` file:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...

# Enable test mode (skips Stripe API calls)
TEST_MODE=true
```

---

## Testing Without Physical Terminal

### Option 1: SQL Mock (Fastest)

```sql
-- Add mock terminal to shop
UPDATE shops 
SET 
  terminal_id = 'tmr_TestReader001',
  terminal_serial = 'TEST-001',
  terminal_status = 'online',
  terminal_model = 'reader_m2'
WHERE id = 'YOUR_SHOP_ID';
```

### Option 2: Enable TEST_MODE

Set `TEST_MODE=true` in environment variables or use `?test=true` query parameter.

### Option 3: Stripe Simulated Reader

1. Go to: https://dashboard.stripe.com/test/terminal/readers
2. Click "Simulate reader"
3. Choose terminal type
4. Use the real endpoints (no TEST_MODE)

---

## Database Schema

Required columns in `shops` table:

```sql
ALTER TABLE shops ADD COLUMN IF NOT EXISTS terminal_id text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS terminal_serial text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS terminal_status text DEFAULT 'offline';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS terminal_model text DEFAULT 'reader_m2';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS location_id text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS stripe_connected_account_id text;
```

---

## Frontend Integration

### Check Terminal Status (Settings Page)

```javascript
const response = await fetch(
  `https://your-domain.com/api/terminal/status/${shopId}`
);
const data = await response.json();

if (data.status === 'not_registered') {
  // Show registration form
} else if (data.status === 'online') {
  // Show "Terminal Online ✅"
} else {
  // Show "Terminal Offline ⚠️"
}
```

### Register Terminal

```javascript
const response = await fetch('/api/terminal/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    shopId: 'YOUR_SHOP_ID',
    registrationCode: 'ABCDE-12345'
  })
});

const result = await response.json();
if (result.success) {
  alert('Terminal registered!');
}
```

### Process Payment (Invoices Page)

```javascript
const response = await fetch('/api/terminal/create-payment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    invoiceId: invoice.id,
    shopId: shopId
  })
});

const result = await response.json();
if (result.success) {
  // Poll database for invoice status change
  pollInvoiceStatus(invoice.id);
}
```

---

## Troubleshooting

### "Stripe not configured"
- Check `STRIPE_SECRET_KEY` is set in environment variables
- Verify key starts with `sk_test_` or `sk_live_`

### "Database connection not available"
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set
- Verify credentials are correct

### "No available terminal found"
- In test mode: Create simulated reader in Stripe Dashboard
- Set `TEST_MODE=true` to skip Stripe entirely

### "Terminal processing failed"
- Check terminal is online and powered on
- Verify terminal is assigned to correct location
- Check Stripe Dashboard for terminal status

---

## Production Deployment

1. Remove `TEST_MODE` or set to `false`
2. Use production Stripe keys (`sk_live_...`)
3. Register real physical terminals
4. Set up webhooks for payment completion
5. Test with test cards before going live

---

## Next Steps

After deploying these endpoints:

1. ✅ Test terminal status endpoint
2. ✅ Test terminal registration (with TEST_MODE)
3. ✅ Test payment creation (with TEST_MODE)
4. Build webhook handler for `payment_intent.succeeded`
5. Add Stripe Connect account creation
6. Add embedded onboarding for bank info
7. Order physical terminal hardware

---

Created: December 22, 2024
