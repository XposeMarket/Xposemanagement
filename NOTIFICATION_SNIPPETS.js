// ================================================================
// READY-TO-PASTE NOTIFICATION CODE SNIPPETS FOR APPOINTMENTS.JS
// ================================================================

// ----------------------------
// SNIPPET 1: NEW APPOINTMENT
// Paste this AFTER: await saveAppointments(allAppointments);
// In function: saveNewAppointment() (around line 1644)
// ----------------------------

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

// ----------------------------
// SNIPPET 2: APPOINTMENT EDITED
// Paste this AFTER: await saveAppointments(allAppointments);
// In function: saveEditedAppointment() (around line 1589)
// ----------------------------

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

// ----------------------------
// SNIPPET 3: STATUS CHANGED
// Paste this AFTER: await saveAppointments(allAppointments);
// In function: updateAppointmentStatus() (around line 1277)
// ----------------------------

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

// ----------------------------
// SNIPPET 4: APPOINTMENT DELETED
// Paste this BEFORE: allAppointments = allAppointments.filter(a => a.id !== pendingDeleteApptId);
// In function: confirmDeleteAppointment() (around line 1831)
// ----------------------------

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
