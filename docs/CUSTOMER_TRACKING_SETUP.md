# Customer Appointment Tracking System

## Overview
This system allows customers to track their vehicle's service status in real-time through a secure, public-facing page. It mirrors the existing invoice system architecture.

## How It Works

### URL Structure
- **Public Tracking Page**: `https://xpose.management/public-tracking.html?token={secure_token}`
- No login required - customers just click the link
- Works like FedEx package tracking

### Token-Based Security
- Secure 64-character tokens generated on appointment creation/update
- 30-day expiration by default
- Stored in `appointment_tokens` table with RLS policies
- Public validation function: `validate_appointment_token(token_value)`

### Customer Access Flow

#### Option 1: Auto-Send on Appointment Creation (Recommended)
```javascript
// In your appointment creation code
const result = await appointmentTracker.autoSendOnCreate(
  appointment,
  customer,
  shopId,
  { sendEmail: true, sendSms: true }
);
```

#### Option 2: Manual Send from Edit Modal
```javascript
// Add button to appointment modal
const result = await appointmentTracker.sendTrackingLink({
  appointmentId: appointment.id,
  shopId: currentShop.id,
  sendEmail: true,
  sendSms: true,
  customerEmail: customer.email,
  customerPhone: customer.phone,
  customerName: `${customer.first_name} ${customer.last_name}`
});

if (result.success) {
  showToast(appointmentTracker.showSuccessMessage(result));
} else {
  showToast(appointmentTracker.getErrorMessage(result), 'error');
}
```

## What Customers See

### Tracking Page Components

1. **Header**
   - Shop logo and name
   - Xpose Management watermark
   - Shop contact info

2. **Vehicle Card**
   - Vehicle info (Year, Make, Model, Plate)
   - Tracking code (first 16 chars of token)

3. **Current Status**
   - Status badge (Scheduled, In Progress, Completed, Cancelled)
   - Assigned technician
   - Scheduled date
   - Estimated completion

4. **Services List**
   - Each service with status icon
   - ✓ Complete, 🔧 In Progress, ⏳ Pending

5. **Invoice Section** (if exists)
   - Total amount
   - Payment status (Paid/Open)
   - Link to full invoice (if available)

6. **Contact Info**
   - Shop phone number for questions

## Database Schema

### appointment_tokens Table
```sql
CREATE TABLE appointment_tokens (
  id UUID PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  appointment_id VARCHAR(255) NOT NULL,
  shop_id VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  sent_via VARCHAR(20)[], -- ['email', 'sms']
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20)
);
```

### RLS Policies
- Shop owners/staff: Full access to their shop's tokens
- Public: Can validate tokens (read-only via `validate_appointment_token()`)

## Implementation Steps

### 1. Run Database Migration
```bash
# In Supabase Dashboard > SQL Editor
# Run: migrations/004_create_appointment_tokens.sql
```

### 2. Add Helper Script to HTML Pages
```html
<!-- In appointments.html or relevant pages -->
<script src="helpers/appointment-tracker.js"></script>
```

### 3. Update Appointment Modal

Add "Send Tracking Link" button:
```html
<!-- In edit appointment modal -->
<button onclick="sendTrackingToCustomer()" class="btn secondary">
  📱 Send Tracking Link
</button>
```

Add handler:
```javascript
async function sendTrackingToCustomer() {
  const appointment = getCurrentAppointment();
  const customer = getCurrentCustomer();
  
  const result = await appointmentTracker.sendTrackingLink({
    appointmentId: appointment.id,
    shopId: currentShop.id,
    sendEmail: true,
    sendSms: true,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    customerName: `${customer.first_name} ${customer.last_name}`
  });
  
  if (result.success) {
    showToast(appointmentTracker.showSuccessMessage(result));
  } else {
    showToast(appointmentTracker.getErrorMessage(result), 'error');
  }
}
```

### 4. Auto-Send on Appointment Creation (Optional)
```javascript
// In createAppointment() function, after saving to database
if (customer.email || customer.phone) {
  await appointmentTracker.autoSendOnCreate(
    newAppointment,
    customer,
    currentShop.id,
    { sendEmail: true, sendSms: true }
  );
}
```

## Email & SMS Templates

### Email Subject
```
Track Your {vehicleDisplay} - {shopName}
```

### Email Body (HTML)
- Shop logo and branding
- Vehicle information card
- Current status badge
- Call-to-action button: "Track Your Vehicle"
- 30-day expiration notice
- Powered by Xpose Management footer

### SMS Message
```
{shopName}: Your {vehicleDisplay} is scheduled for {date}. 
Track your vehicle's status here: {trackingUrl}
```

## API Endpoints

### POST /api/send-tracking
Send tracking link via email/SMS

**Request Body:**
```json
{
  "appointmentId": "apt-123",
  "shopId": "shop-abc",
  "sendEmail": true,
  "sendSms": true,
  "customerEmail": "customer@example.com",
  "customerPhone": "+12345678901",
  "customerName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "trackingUrl": "https://xpose.management/public-tracking.html?token=abc123...",
  "token": "abc123...",
  "results": {
    "email": { "success": true, "id": "email-id" },
    "sms": { "success": true, "sid": "sms-sid" }
  }
}
```

## Environment Variables Required

Same as invoice system:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY` (for email)
- `TWILIO_ACCOUNT_SID` (for SMS)
- `TWILIO_AUTH_TOKEN` (for SMS)
- `APP_BASE_URL` (e.g., https://xpose.management)

## Customer Benefits

✅ **No Login Friction** - Just click the link
✅ **Real-Time Updates** - See status changes immediately
✅ **Transparency** - Know who's working on their vehicle
✅ **Shareable** - Can forward to spouse/family
✅ **Professional** - Builds trust and reduces "where's my car?" calls

## Shop Benefits

✅ **Reduce Phone Calls** - Customers self-serve status checks
✅ **Professional Image** - Modern, transparent service
✅ **Customer Satisfaction** - Keep customers informed
✅ **Xpose Branding** - Every view shows Xpose watermark
✅ **Analytics** - Track when customers view (via `used_at`)

## Future Enhancements

### Phase 2 Features
- [ ] Push notifications when status changes
- [ ] Photo uploads - techs add progress photos
- [ ] Approval requests - "Additional service needed: $X - Approve?"
- [ ] Rating prompt when job marked complete
- [ ] Customer login portal for viewing all vehicles/history
- [ ] Real-time updates using Supabase subscriptions

### Optional Customer Portal
For customers with multiple vehicles:
- Login with email + tracking code
- See all appointments across all vehicles
- View service history
- Manage notifications preferences

## Troubleshooting

### Token Not Found
- Check token hasn't expired (30 days)
- Verify `appointment_tokens` table exists
- Check RLS policies are applied

### Email/SMS Not Sending
- Verify API keys in environment variables
- Check Twilio number configured for shop
- Review API logs in Vercel/deployment platform

### Data Not Loading
- Verify appointment exists in `data.appointments`
- Check shop_id matches
- Review browser console for errors

## Files Created

```
/public-tracking.html              - Public tracking page
/api/send-tracking.js              - API endpoint for sending links
/helpers/appointment-tracker.js    - Helper module for tracking
/migrations/004_create_appointment_tokens.sql - Database schema
```

## Related Documentation

- Invoice system: `docs/INVOICE_SENDING_SETUP.md`
- Twilio setup: (existing docs)
- Resend setup: (existing docs)
