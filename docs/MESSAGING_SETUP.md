# Twilio Messaging Integration - Setup Guide

## Overview
This integration enables per-shop Twilio phone numbers for SMS/MMS messaging with customers. Each shop gets its own dedicated phone number, and all messages are stored in Supabase with real-time sync.

## Architecture

### Database Schema
- **shop_twilio_numbers**: Stores provisioned phone numbers per shop
- **customers**: Enhanced with `phone_normalized` (E.164 format) for lookups
- **threads**: Message conversations (shop + customer + twilio_number)
- **messages**: Individual SMS/MMS messages with status tracking

### Backend Components
- **helpers/messaging-api.js**: Core Twilio integration
  - `provisionNumber()`: Buy phone numbers via Twilio API
  - `sendMessage()`: Send outbound SMS/MMS
  - `receiveWebhook()`: Handle incoming messages
  - `receiveStatusCallback()`: Track delivery status
  - `getThreads()` & `getMessages()`: Fetch data
  - `releaseNumber()`: Deprovision numbers

- **server.js**: Express routes
  - `POST /api/messaging/provision` - Provision new number
  - `POST /api/messaging/send` - Send message
  - `POST /api/messaging/webhook` - Twilio incoming webhook
  - `POST /api/messaging/status` - Twilio status callback
  - `GET /api/messaging/threads/:shopId` - Get threads
  - `GET /api/messaging/messages/:threadId` - Get messages
  - `DELETE /api/messaging/numbers/:numberId` - Release number

### Frontend Components
- **pages/messages-backend.js**: Supabase-integrated UI
  - Loads threads and messages from Supabase
  - Sends messages via `/api/messaging/send`
  - Subscribes to Realtime updates
  - Mobile-responsive (full-screen panels)

## Setup Instructions

### 1. Twilio Account Setup

1. **Create Twilio Account**
   - Sign up at https://www.twilio.com
   - Verify your account (may require ID verification for production)

2. **Get Credentials**
   - Dashboard → Account Info
   - Copy: Account SID, Auth Token

3. **Configure Webhooks (After Deployment)**
   - Console → Phone Numbers → Active Numbers
   - For each number (auto-configured during provisioning):
     - SMS & MMS → Webhook: `https://your-domain.com/api/messaging/webhook` (POST)
     - Status Callback: `https://your-domain.com/api/messaging/status` (POST)

4. **US 10DLC Registration (Required for Production)**
   - Console → Messaging → Regulatory Compliance
   - Register your business
   - Register A2P 10DLC Campaign
   - Allows higher throughput & better deliverability
   - **Cost**: ~$4/month per campaign + $1.50/month per number

5. **Buy Initial Numbers (Optional)**
   - Console → Phone Numbers → Buy a Number
   - Or use the provision API endpoint

### 2. Database Migration

Run the SQL migration in Supabase SQL Editor:

```sql
-- Run: migrations/001_add_messaging_tables.sql
```

This creates:
- `shop_twilio_numbers` table
- `threads` table
- `messages` table
- Updates `customers` table with `phone_normalized`
- Creates indexes and RLS policies
- Sets up triggers for `updated_at` and `last_message`

### 3. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Supabase (existing)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Twilio (new)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token

# App URL (for webhooks)
APP_BASE_URL=https://xposemanagement.com
```

**Development/Testing with ngrok:**
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Update .env:
APP_BASE_URL=https://abc123.ngrok.io
```

### 4. Install Dependencies

```bash
npm install
```

This installs the `twilio` package (v5.3.5).

### 5. Start Server

```bash
npm start
# Server runs on http://localhost:3000
```

### 6. Frontend Integration

Option A: Replace existing messages.js (recommended for production)
```javascript
// In app.js, change:
import { setupMessages } from './pages/messages-backend.js';
```

Option B: Test alongside existing (for gradual migration)
- Keep both files
- Create a feature flag or separate route

## Usage

### Provisioning a Number for a Shop

**API Request:**
```bash
curl -X POST http://localhost:3000/api/messaging/provision \
  -H "Content-Type: application/json" \
  -d '{
    "shopId": "uuid-of-shop",
    "country": "US",
    "areaCode": "415"
  }'
```

**Response:**
```json
{
  "success": true,
  "number": {
    "id": "uuid",
    "shop_id": "uuid-of-shop",
    "phone_number": "+14155551234",
    "twilio_sid": "PNxxxxx",
    "provisioning_status": "active",
    "monthly_cost": 5.00
  }
}
```

**Frontend (Admin Panel):**
```javascript
// Add to settings.html or admin panel
async function provisionNumber(shopId, areaCode) {
  const response = await fetch('/api/messaging/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopId, areaCode })
  });
  return await response.json();
}
```

### Sending a Message

**API Request:**
```bash
curl -X POST http://localhost:3000/api/messaging/send \
  -H "Content-Type: application/json" \
  -d '{
    "shopId": "uuid-of-shop",
    "to": "+14155559876",
    "body": "Hi! Your vehicle is ready for pickup.",
    "mediaUrls": []
  }'
```

**Frontend (Messages Page):**
- Already implemented in `pages/messages-backend.js`
- User types message → clicks Send → calls `/api/messaging/send`
- Message appears in chat via Realtime subscription

### Receiving Messages

1. **Customer sends SMS to your shop's Twilio number**
2. **Twilio POSTs to** `/api/messaging/webhook`
3. **Backend:**
   - Looks up shop by phone number
   - Finds or creates customer (by phone)
   - Finds or creates thread
   - Inserts message to `messages` table
   - Updates thread `last_message` and `unread_count`
4. **Frontend:**
   - Supabase Realtime pushes new message to client
   - Message appears in active thread immediately
   - Thread list updates with new last_message

### Status Updates (Delivery Receipts)

1. **Twilio POSTs to** `/api/messaging/status`
2. **Backend updates message status:**
   - `queued` → `sent` → `delivered` (or `failed`)
3. **Frontend can show delivery indicators** (future enhancement)

## Billing & Subscription Model

### Option 1: Included in Subscription
- Include 1 phone number per shop in base subscription
- Cover Twilio costs as platform expense
- Simplest for customers
- **Cost to you:** ~$1-2/month per number + $0.0075/SMS

### Option 2: Paid Add-On (Recommended)
- Charge $5-10/month per phone number
- Covers Twilio costs + margin
- Per-message charges or usage bucket (e.g., 500 SMS/month included)
- **Profit margin:** ~$4-8/month per number

### Implementation in Subscription System

Update `settings.html` or admin panel:

```javascript
// Add messaging add-on option
const messagingAddon = {
  name: 'Business Messaging',
  description: 'Dedicated phone number for SMS with customers',
  price: 5.00, // monthly
  features: [
    'Dedicated phone number',
    '500 SMS messages/month included',
    'MMS support (images)',
    'Two-way conversations',
    'Message history'
  ]
};

// On checkout, provision number automatically:
async function enableMessaging(shopId) {
  // 1. Charge customer via Stripe
  // 2. Provision Twilio number
  const result = await fetch('/api/messaging/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopId })
  });
  // 3. Update shop record
  await supabase
    .from('shops')
    .update({ messaging_enabled: true })
    .eq('id', shopId);
}
```

## Testing Checklist

- [ ] Run SQL migration in Supabase
- [ ] Set environment variables (Twilio + Supabase)
- [ ] Start server with `npm start`
- [ ] Test provisioning: `POST /api/messaging/provision`
- [ ] Configure ngrok for local webhook testing
- [ ] Test sending: `POST /api/messaging/send`
- [ ] Test receiving: Send SMS to provisioned number
- [ ] Verify message appears in Supabase `messages` table
- [ ] Test frontend: Open messages.html, see threads/messages
- [ ] Test Realtime: Send message, verify it appears instantly
- [ ] Test mobile view: Responsive layout, full-screen panels

## Production Checklist

- [ ] Deploy server to production (Vercel/Railway/Render)
- [ ] Update `APP_BASE_URL` in production env
- [ ] Configure Twilio webhooks with production URL
- [ ] Complete 10DLC registration (US)
- [ ] Set up monitoring (Twilio logs + Supabase logs)
- [ ] Implement webhook signature validation (uncomment in code)
- [ ] Add opt-in/opt-out handling (TCPA compliance)
- [ ] Add rate limiting for send endpoint
- [ ] Set up error alerting (failed messages)
- [ ] Test international numbers (if supporting non-US)
- [ ] Document pricing for customers
- [ ] Create admin UI for number provisioning
- [ ] Implement usage tracking & billing

## Troubleshooting

### Messages not appearing in frontend
- Check Supabase Realtime is enabled (Dashboard → Database → Replication)
- Verify RLS policies allow reads for authenticated users
- Check browser console for Supabase errors

### Webhook not receiving messages
- Verify `APP_BASE_URL` matches your public URL
- Check Twilio webhook configuration in Console
- Use ngrok for local testing
- Check server logs for POST requests to `/api/messaging/webhook`

### Message send failures
- Verify Twilio credentials are correct
- Check phone number format (must be E.164: +1XXXXXXXXXX)
- Verify shop has active provisioned number
- Check Twilio Console → Monitor → Logs for error details

### 10DLC blocking messages (US)
- Register your business with Twilio
- Register A2P 10DLC campaign
- Allow 1-2 days for approval
- Use toll-free numbers as fallback during registration

## Cost Estimates

### Per Shop (US)
- **Phone Number:** $1/month (Twilio) + $4/month (your markup) = $5/month
- **10DLC Campaign:** $4/month (shared across all shops)
- **SMS Outbound:** $0.0079/message (Twilio) + markup = $0.01/message
- **SMS Inbound:** $0.0079/message (Twilio) + markup = $0.01/message
- **MMS:** $0.02/message (Twilio) + markup

### Platform (100 shops)
- **Numbers:** $100/month (Twilio) | **Revenue:** $500/month | **Margin:** $400/month
- **10DLC:** $4/month (one-time campaign, shared)
- **Messages:** Variable based on usage

## Advanced Features (Future)

- [ ] Auto-replies / canned responses
- [ ] Message templates
- [ ] Scheduled messages
- [ ] Group messaging / broadcast
- [ ] WhatsApp integration (Twilio API)
- [ ] Voice calls (Twilio Voice API)
- [ ] Message analytics dashboard
- [ ] Conversation AI / chatbot integration
- [ ] Multi-number support per shop (e.g., sales vs support)

## Support

- **Twilio Docs:** https://www.twilio.com/docs/sms
- **Supabase Realtime:** https://supabase.com/docs/guides/realtime
- **10DLC Registration:** https://www.twilio.com/docs/sms/a2p-10dlc

---

**Created:** November 2025
**Version:** 1.0
