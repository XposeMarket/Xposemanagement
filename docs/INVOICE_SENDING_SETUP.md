# Invoice Email/SMS Sending - Setup Guide

## Overview

This feature allows shops to automatically send invoices to customers via email and/or SMS after checkout. Customers receive a secure link to view their invoice without needing to log in.

## Features

- ✅ **Email invoices** via Resend API (beautiful HTML emails)
- ✅ **SMS invoices** via Twilio (with invoice link)
- ✅ **Public invoice page** - customers can view without login
- ✅ **Secure token-based URLs** - 30-day expiry
- ✅ **Auto-prompt after payment** - modal appears after marking invoice paid
- ✅ **Send from invoice view** - "Send to Customer" button on invoice page

## Files Created/Modified

### New Files

1. **migrations/003_create_invoice_tokens.sql**
   - Creates `invoice_tokens` table for secure URL tokens
   - Includes RLS policies for security
   - Helper function `validate_invoice_token()` for public validation

2. **public-invoice.html**
   - Public-facing invoice view page
   - No authentication required
   - Validates token and displays invoice

3. **api/send-invoice.js**
   - API endpoint for sending invoices
   - Generates secure tokens
   - Sends email via Resend
   - Sends SMS via Twilio

### Modified Files

4. **invoices.html**
   - Added "Send Invoice" modal HTML

5. **pages/invoices.js**
   - Added `showSendInvoiceModal()` function
   - Added `sendInvoiceToCustomer()` function
   - Auto-shows modal after marking invoice as paid

6. **invoice.html**
   - Added "Send to Customer" button
   - Added send invoice modal and JS functionality

## Setup Instructions

### 1. Run Database Migration

Go to Supabase Dashboard → SQL Editor and run:

```sql
-- Run the contents of: migrations/003_create_invoice_tokens.sql
```

This creates:
- `invoice_tokens` table
- RLS policies
- `validate_invoice_token()` function

### 2. Environment Variables

Add these to your Vercel/deployment environment:

```bash
# Required for email sending
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx

# Already have these for SMS (from Twilio messaging setup)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Your app's base URL
APP_BASE_URL=https://xposemanagement.com
```

### 3. Set Up Resend Account

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain (or use their test domain for development)
3. Get API key from Dashboard → API Keys
4. Add `RESEND_API_KEY` to environment variables

**Free tier includes:**
- 3,000 emails/month
- 100 emails/day

### 4. Twilio Setup (If Not Already Done)

You should already have Twilio configured for messaging. Ensure:
- Shop has a provisioned Twilio number in `shop_twilio_numbers` table
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set

## Usage

### After Checkout (Automatic)

1. Open an invoice
2. Click "Checkout" 
3. Complete payment (or click "Mark Paid Manually")
4. **Send Invoice modal automatically appears**
5. Select email and/or SMS checkboxes
6. Click "Send Invoice"

### From Invoice View (Manual)

1. View any invoice (invoice.html?id=xxx)
2. Click "📤 Send to Customer" button
3. Select delivery methods
4. Click "Send Invoice"

## Customer Experience

1. Customer receives email/SMS with invoice link
2. Clicks link → goes to `public-invoice.html?token=xxx`
3. Sees full invoice details
4. No login required

## Email Template

The email includes:
- Shop logo and name
- Invoice number and amount due
- "View Invoice" button
- Professional styling

## API Reference

### POST /api/send-invoice

**Request Body:**
```json
{
  "invoiceId": "uuid",
  "shopId": "uuid",
  "sendEmail": true,
  "sendSms": true,
  "customerEmail": "customer@example.com",
  "customerPhone": "+1234567890",
  "customerName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "invoiceUrl": "https://xposemanagement.com/public-invoice.html?token=xxx",
  "token": "xxx",
  "results": {
    "email": { "success": true, "id": "resend-message-id" },
    "sms": { "success": true, "sid": "twilio-message-sid" }
  }
}
```

## Troubleshooting

### Email not sending
- Check `RESEND_API_KEY` is set correctly
- Verify domain in Resend dashboard
- Check API logs for errors

### SMS not sending
- Verify shop has Twilio number provisioned
- Check `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
- Ensure phone number is in valid format

### Token validation failing
- Run the database migration
- Check `invoice_tokens` table has correct RLS policies
- Verify `validate_invoice_token()` function exists

### Customer contact info missing
- Ensure customer has email/phone in `customers` table
- Invoice must have `customer_id` linked to a customer record

## Security Notes

- Tokens are 64-character random hex strings
- Tokens expire after 30 days
- Public invoice page only shows invoice data (no edit capability)
- RLS policies restrict token management to shop owners/staff
- Token validation uses Supabase RPC for secure checking
