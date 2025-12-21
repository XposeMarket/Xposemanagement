# 🚀 Notification System - Quick Start Guide

## What You Have Now

✅ **Database Ready** - Schema upgraded with new columns  
✅ **Helper Function** - `createShopNotification()` in `helpers/shop-notifications.js`  
✅ **Integration Guides** - Detailed instructions for each module  

## 5-Minute Quick Start

### Step 1: Test the Helper Function

Open your browser console and test that the notification system works:

```javascript
// Get references
const supabase = await import('./helpers/supabase.js').then(m => m.getSupabaseClient());
const { createShopNotification } = await import('./helpers/shop-notifications.js');

// Get current shop
const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
const shopId = session.shopId;

// Create a test notification
await createShopNotification({
  supabase,
  shopId,
  type: 'test_notification',
  category: 'appointment',
  title: 'Test Notification',
  message: 'This is a test notification to verify the system works!',
  relatedId: 'test-123',
  relatedType: 'appointment',
  metadata: { test: true },
  priority: 'normal',
  createdBy: session.userId || null
});

// Check your notification bell - you should see a new notification!
```

---

### Step 2: Add Your First Integration (Appointments)

1. **Open** `pages/appointments.js`

2. **Find** the `saveNewAppointment()` function (around line 1644)

3. **Locate** this code:
```javascript
allAppointments.push(newAppt);
await saveAppointments(allAppointments);
```

4. **Add** this code RIGHT AFTER `saveAppointments()`:
```javascript
// ✨ NOTIFICATION: New appointment created
const shopId = getCurrentShopId();
const currentUser = getCurrentUser();
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId,
  type: 'appointment_created',
  category: 'appointment',
  title: 'New Appointment Created',
  message: `${first} ${last} scheduled ${service || 'service'} for ${vehicle || 'their vehicle'}`,
  relatedId: newAppt.id,
  relatedType: 'appointment',
  metadata: {
    customer_name: `${first} ${last}`,
    phone: phone || '',
    vehicle: vehicle || '',
    service: service || '',
    scheduled_date: date || '',
    scheduled_time: time || ''
  },
  priority: 'normal',
  createdBy: currentUser?.id || null
});
```

5. **Save** the file

6. **Test** by creating a new appointment - you should see a notification appear!

---

### Step 3: Verify It Works

1. Go to your Appointments page
2. Click "New Appointment"
3. Fill out the form and save
4. **Check the notification bell** - you should see:
   - Badge count increased
   - New notification in the list
   - Blue priority badge (normal priority)

---

## What's Next?

Now that you have ONE notification working, you can easily add the rest:

### Option A: Copy-Paste All Appointment Notifications (Recommended)
Use `NOTIFICATION_SNIPPETS.js` which has all 4 appointment integrations ready to paste:
1. New appointment ✅ (you just did this!)
2. Edit appointment
3. Status change
4. Delete appointment

### Option B: Move to Other Modules
Follow the `NOTIFICATION_INTEGRATION_MASTER_PLAN.md` for:
- Jobs notifications
- Invoice notifications (especially payments!)
- Customer message notifications
- Inventory alerts

---

## Troubleshooting

### "Notification doesn't appear"
- Check browser console for errors
- Verify `shopId` is not null
- Ensure you're logged in as admin/owner
- Check network tab - is the INSERT to notifications table succeeding?

### "Can't find the function"
Make sure `appointments.js` imports the helper:
```javascript
import { createShopNotification } from '../helpers/shop-notifications.js';
```

### "Error: shop_id cannot be null"
The `getCurrentShopId()` function is returning null. Make sure you're logged into a shop.

---

## Priority Guide

When adding notifications, use this priority guide:

**Normal (Blue):**
- Creating records
- Editing records
- Routine updates

**High (Orange):**
- Completing work
- Assigning tasks
- Customer messages
- Payments received

**Urgent (Red):**
- Low stock alerts
- Failed operations
- Critical errors

---

## File Reference

📄 **Integration Guides:**
- `APPOINTMENTS_NOTIFICATION_INTEGRATION.md` - Detailed appointment integration
- `NOTIFICATION_SNIPPETS.js` - Copy-paste ready code
- `NOTIFICATION_INTEGRATION_MASTER_PLAN.md` - Complete system overview

📂 **Key Files:**
- `helpers/shop-notifications.js` - The notification helper function
- `pages/appointments.js` - Where you'll add appointment notifications
- `pages/jobs.js` - Jobs notifications (next priority)
- SQL files - Database schema (already applied)

---

## Getting Help

If you get stuck:
1. Check the browser console for errors
2. Review the integration examples in `INTEGRATION_EXAMPLES.js`
3. Verify your database migration completed successfully
4. Test the helper function directly in console (Step 1 above)

---

## Success Metrics

You'll know the system is working when:
✅ Notification bell shows count badge  
✅ Creating appointments generates notifications  
✅ Multiple admins see the same notifications  
✅ Clicking notifications shows details  
✅ Priority colors display correctly  

---

**Ready to start?** Begin with Step 1 above to test the system, then move to Step 2 to add your first real integration!
