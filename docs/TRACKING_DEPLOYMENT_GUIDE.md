# Customer Tracking System - FIXED VERSION

## ✅ Issues Resolved

### 1. SQL Migration Fixed
**Problem**: Syntax error on RETURN QUERY
**Solution**: Reorganized migration into clear steps with DROP POLICY IF EXISTS statements

### 2. URL Corrections
**Problem**: Used wrong domain (xposemanagement.com)
**Solution**: Updated all URLs to **xpose.management**

## 🚀 Ready to Deploy

### Step 1: Run Fixed SQL Migration

Copy and paste this into **Supabase Dashboard > SQL Editor**:

```sql
-- Just run the entire file
D:\Websites\Xposemanagement\migrations\004_create_appointment_tokens.sql
```

The migration is now structured in clear steps:
1. Create table
2. Create indexes  
3. Enable RLS
4. Drop existing policies (if any)
5. Create RLS policies
6. Create validation function
7. Create cleanup function

### Step 2: Verify API Endpoint

File is ready at: `api/send-tracking.js`

Uses correct URL: `https://xpose.management`

### Step 3: Test the System

1. **Create a test tracking link:**
```sql
-- In Supabase SQL Editor
INSERT INTO appointment_tokens (
  token, 
  appointment_id, 
  shop_id, 
  expires_at
) VALUES (
  'test-token-123abc',
  'your-appointment-id',
  'your-shop-id',
  NOW() + INTERVAL '30 days'
);
```

2. **Visit the tracking page:**
```
https://xpose.management/public-tracking.html?token=test-token-123abc
```

3. **Should see:**
- Loading spinner → Tracking page
- Shop logo and info
- Vehicle details
- Status and services
- Xpose Management branding

## 📝 Quick Integration Guide

### Add to Appointment Modal

```html
<!-- In your appointment edit modal -->
<button onclick="sendCustomerTracking()" class="btn secondary">
  📱 Send Tracking Link
</button>
```

```javascript
// In appointments.html or relevant page
async function sendCustomerTracking() {
  const appointment = currentEditingAppointment;
  const customer = customers.find(c => c.id === appointment.customer_id);
  
  if (!customer) {
    showToast('Customer not found', 'error');
    return;
  }
  
  const result = await appointmentTracker.sendTrackingLink({
    appointmentId: appointment.id,
    shopId: currentShop.id,
    sendEmail: !!customer.email,
    sendSms: !!customer.phone,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    customerName: `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
  });
  
  if (result.success) {
    showToast('✅ Tracking link sent!');
  } else {
    showToast('Failed to send: ' + result.error, 'error');
  }
}
```

### Add Helper Script

```html
<!-- In appointments.html <head> section -->
<script src="helpers/appointment-tracker.js"></script>
```

## ✨ What's Included

### Files Created
- ✅ `public-tracking.html` - Beautiful customer portal
- ✅ `api/send-tracking.js` - API endpoint  
- ✅ `helpers/appointment-tracker.js` - Helper functions
- ✅ `migrations/004_create_appointment_tokens.sql` - Database schema (FIXED)
- ✅ `docs/CUSTOMER_TRACKING_SETUP.md` - Full documentation

### All URLs Corrected
- API defaults to `xpose.management` ✅
- Email templates use `xpose.management` ✅  
- Documentation references `xpose.management` ✅
- Public page footer links to `xpose.management` ✅

## 🎯 Test Checklist

After deploying:

- [ ] Run SQL migration successfully
- [ ] Create test appointment
- [ ] Send tracking link via SMS/Email
- [ ] Click link and verify page loads
- [ ] Check shop logo displays
- [ ] Verify vehicle info shows correctly
- [ ] Confirm status badge appears
- [ ] Test on mobile device

## 🔧 Environment Variables

Make sure these are set (same as invoice system):

```env
SUPABASE_URL=https://hxwufjzyhtwveyxbkkya.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key_here
RESEND_API_KEY=your_resend_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
APP_BASE_URL=https://xpose.management
```

## 💡 Pro Tips

1. **Auto-send on appointment creation:**
   Add this after saving new appointment:
   ```javascript
   if (customer.email || customer.phone) {
     appointmentTracker.autoSendOnCreate(appointment, customer, currentShop.id);
   }
   ```

2. **Resend if customer loses link:**
   Same button works - just generates new token

3. **Track customer engagement:**
   Check `used_at` timestamp in `appointment_tokens` table

## 🐛 Troubleshooting

**SQL Error**: Make sure you're running the FIXED version (004_create_appointment_tokens.sql)

**Link doesn't work**: 
- Check token exists in `appointment_tokens` table
- Verify not expired (30 days)
- Check RLS policies applied

**SMS not sending**:
- Verify Twilio number configured for shop in `shop_twilio_numbers` table
- Check phone format is E.164 (+12345678901)

**Page shows error**:
- Check browser console for details
- Verify appointment exists in `data.appointments`
- Confirm shop_id matches

---

**All fixed and ready to go! 🚀**
