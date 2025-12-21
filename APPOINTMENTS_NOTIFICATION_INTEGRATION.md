# Appointments.js Notification Integration Guide

## Integration Points for Notifications

Your `appointments.js` already imports `createShopNotification` at line 14:
```javascript
import { createShopNotification } from '../helpers/shop-notifications.js';
```

Now you need to add notification calls at these 4 key points:

---

## 1. NEW APPOINTMENT CREATED

**Location:** `saveNewAppointment()` function (around line 1644)

**Find this code:**
```javascript
allAppointments.push(newAppt);
await saveAppointments(allAppointments);
```

**Add AFTER `saveAppointments()` but BEFORE the success notification:**
```javascript
allAppointments.push(newAppt);
await saveAppointments(allAppointments);

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

await addServiceToInvoice(newAppt.id, newAppt.service);
```

---

## 2. APPOINTMENT EDITED/UPDATED

**Location:** `saveEditedAppointment()` function (around line 1589)

**Find this code:**
```javascript
await saveAppointments(allAppointments);

// 🆕 Update customer in customers table (with vehicle)
```

**Add BEFORE the customer update comment:**
```javascript
await saveAppointments(allAppointments);

// ✨ NOTIFICATION: Appointment edited
const shopId = getCurrentShopId();
const currentUser = getCurrentUser();
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId,
  type: 'appointment_edited',
  category: 'appointment',
  title: 'Appointment Updated',
  message: `${customer_first} ${customer_last}'s appointment details were modified`,
  relatedId: currentApptId,
  relatedType: 'appointment',
  metadata: {
    customer_name: `${customer_first} ${customer_last}`,
    vehicle,
    service: allAppointments[index].service
  },
  priority: 'normal',
  createdBy: currentUser?.id || null
});

// 🆕 Update customer in customers table (with vehicle)
```

---

## 3. STATUS CHANGED

**Location:** `updateAppointmentStatus()` function (around line 1277)

**Find this code:**
```javascript
allAppointments[index].status = newStatus;
allAppointments[index].updated_at = new Date().toISOString();

await saveAppointments(allAppointments);
```

**Add AFTER `saveAppointments()` but BEFORE `renderAppointments()`:**
```javascript
allAppointments[index].status = newStatus;
allAppointments[index].updated_at = new Date().toISOString();

await saveAppointments(allAppointments);

// ✨ NOTIFICATION: Status changed
const appt = allAppointments[index];
const shopId = getCurrentShopId();
const currentUser = getCurrentUser();

// Determine priority based on status
let priority = 'normal';
if (newStatus === 'completed') priority = 'high';
if (newStatus === 'in_progress') priority = 'high';

const customerName = appt.customer || `${appt.customer_first} ${appt.customer_last}`.trim();

await createShopNotification({
  supabase: getSupabaseClient(),
  shopId,
  type: 'appointment_status_changed',
  category: 'appointment',
  title: 'Appointment Status Updated',
  message: `${customerName}'s appointment status changed to ${newStatus.replace(/_/g, ' ')}`,
  relatedId: apptId,
  relatedType: 'appointment',
  metadata: {
    customer_name: customerName,
    new_status: newStatus,
    vehicle: appt.vehicle || '',
    service: appt.service || ''
  },
  priority,
  createdBy: currentUser?.id || null
});

renderAppointments();
```

---

## 4. APPOINTMENT DELETED

**Location:** `confirmDeleteAppointment()` function (around line 1831)

**Find this code (near the end of the function):**
```javascript
allAppointments = allAppointments.filter(a => a.id !== pendingDeleteApptId);
await saveAppointments(allAppointments);
renderAppointments();
showNotification('Appointment and related jobs/invoices deleted');
hideDeleteApptModal();
```

**Add BEFORE filtering the appointments:**
```javascript
// ✨ NOTIFICATION: Appointment deleted
const appt = allAppointments.find(a => a.id === pendingDeleteApptId);
if (appt) {
  const shopId = getCurrentShopId();
  const currentUser = getCurrentUser();
  const customerName = appt.customer || `${appt.customer_first} ${appt.customer_last}`.trim();
  
  await createShopNotification({
    supabase: getSupabaseClient(),
    shopId,
    type: 'appointment_deleted',
    category: 'appointment',
    title: 'Appointment Deleted',
    message: `${customerName}'s appointment for ${appt.service || 'service'} was deleted`,
    relatedId: pendingDeleteApptId,
    relatedType: 'appointment',
    metadata: {
      customer_name: customerName,
      vehicle: appt.vehicle || '',
      service: appt.service || '',
      scheduled_date: appt.preferred_date || '',
      related_jobs: relatedJobs?.length || 0,
      related_invoices: relatedInvoices?.length || 0
    },
    priority: 'high',
    createdBy: currentUser?.id || null
  });
}

allAppointments = allAppointments.filter(a => a.id !== pendingDeleteApptId);
```

---

## Summary

After adding these 4 integration points, your appointments.js will automatically create notifications for:

✅ **New appointments** - Normal priority, shows customer/vehicle/service  
✅ **Edited appointments** - Normal priority, shows what was modified  
✅ **Status changes** - High priority for completed/in_progress  
✅ **Deleted appointments** - High priority, shows related records deleted  

## Testing Checklist

- [ ] Create a new appointment → Check bell icon shows notification
- [ ] Edit an appointment → Check notification appears
- [ ] Change appointment status → Check notification with correct priority
- [ ] Delete an appointment → Check notification appears
- [ ] Click notification → Should navigate to appointments page (future feature)

## Notes

- All notifications go to admins/owners automatically
- Metadata allows for future filtering/searching
- Priority determines badge color (normal=blue, high=orange, urgent=red)
- `createdBy` tracks which staff member made the change
