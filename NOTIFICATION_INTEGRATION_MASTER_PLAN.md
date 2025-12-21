# Complete Notification System Integration Plan

## Phase 1: Database ✅ COMPLETE
- [x] Database schema upgraded
- [x] New columns added to notifications table
- [x] Helper function created in `shop-notifications.js`

## Phase 2: Core Modules Integration

### Module 1: Appointments (PRIORITY 1)
**File:** `pages/appointments.js`  
**Status:** Ready for integration  
**Reference:** See `APPOINTMENTS_NOTIFICATION_INTEGRATION.md` for detailed instructions

**Integration Points:**
- ✅ New appointment created → Normal priority
- ✅ Appointment edited → Normal priority
- ✅ Status changed → High priority (for completed/in_progress)
- ✅ Appointment deleted → High priority

---

### Module 2: Jobs (PRIORITY 1)
**File:** `pages/jobs.js`  
**Status:** Ready for integration

**Integration Points to Add:**

#### 1. New Job Created
```javascript
// In createJobFromAppointment() or equivalent
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'job_created',
  category: 'job',
  title: 'New Job Created',
  message: `${customerName} - ${service}`,
  relatedId: jobId,
  relatedType: 'job',
  metadata: { customer_name: customerName, service, vehicle },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

#### 2. Technician Assigned
```javascript
// When assigning technician
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'job_assigned',
  category: 'job',
  title: 'Technician Assigned',
  message: `${technicianName} assigned to ${customerName}'s ${service}`,
  relatedId: jobId,
  relatedType: 'job',
  metadata: { technician_name: technicianName, customer_name: customerName },
  priority: 'high',
  createdBy: getCurrentUser()?.id
});
```

#### 3. Job Status Changed
```javascript
// When status changes
const priority = newStatus === 'completed' ? 'high' : 'normal';
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'job_status_changed',
  category: 'job',
  title: 'Job Status Updated',
  message: `${customerName}'s job status changed to ${newStatus.replace(/_/g, ' ')}`,
  relatedId: jobId,
  relatedType: 'job',
  metadata: { new_status: newStatus, customer_name: customerName },
  priority,
  createdBy: getCurrentUser()?.id
});
```

#### 4. Parts Added to Job
```javascript
// When parts added
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'job_parts_added',
  category: 'job',
  title: 'Parts Added to Job',
  message: `${partCount} part(s) added to ${customerName}'s job`,
  relatedId: jobId,
  relatedType: 'job',
  metadata: { customer_name: customerName, part_count: partCount },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

---

### Module 3: Invoices (PRIORITY 2)
**File:** `pages/invoices.js`

**Integration Points to Add:**

#### 1. Invoice Created
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'invoice_created',
  category: 'invoice',
  title: 'New Invoice Created',
  message: `Invoice #${invoiceNumber} for ${customerName}`,
  relatedId: invoiceId,
  relatedType: 'invoice',
  metadata: { invoice_number: invoiceNumber, customer_name: customerName },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

#### 2. Invoice Paid 💰
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'invoice_paid',
  category: 'financial',
  title: '💰 Payment Received',
  message: `${customerName} paid $${amount} (Invoice #${invoiceNumber})`,
  relatedId: invoiceId,
  relatedType: 'invoice',
  metadata: { 
    customer_name: customerName, 
    amount, 
    invoice_number: invoiceNumber,
    payment_method: paymentMethod 
  },
  priority: 'high', // Money matters!
  createdBy: getCurrentUser()?.id
});
```

#### 3. Invoice Emailed
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'invoice_emailed',
  category: 'invoice',
  title: 'Invoice Sent',
  message: `Invoice #${invoiceNumber} emailed to ${customerEmail}`,
  relatedId: invoiceId,
  relatedType: 'invoice',
  metadata: { invoice_number: invoiceNumber, email: customerEmail },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

---

### Module 4: Inventory (PRIORITY 2)
**File:** `pages/inventory.js` or similar

**Integration Points to Add:**

#### 1. Low Stock Alert ⚠️
```javascript
// When checking inventory levels
if (quantity <= lowStockThreshold) {
  await createShopNotification({
    supabase: getSupabaseClient(),
    shopId: getCurrentShopId(),
    type: 'inventory_low_stock',
    category: 'inventory',
    title: '⚠️ Low Stock Alert',
    message: `${partName} is running low (${quantity} remaining)`,
    relatedId: partId,
    relatedType: 'part',
    metadata: { 
      part_name: partName, 
      quantity, 
      threshold: lowStockThreshold 
    },
    priority: 'urgent',
    createdBy: null // System-generated
  });
}
```

#### 2. New Part Added
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'inventory_part_added',
  category: 'inventory',
  title: 'Part Added to Inventory',
  message: `${partName} added to inventory (Qty: ${quantity})`,
  relatedId: partId,
  relatedType: 'part',
  metadata: { part_name: partName, quantity, price },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

#### 3. Stock Quantity Updated
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'inventory_quantity_updated',
  category: 'inventory',
  title: 'Stock Quantity Updated',
  message: `${partName}: ${oldQuantity} → ${newQuantity}`,
  relatedId: partId,
  relatedType: 'part',
  metadata: { 
    part_name: partName, 
    old_quantity: oldQuantity, 
    new_quantity: newQuantity 
  },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

---

### Module 5: Messages/SMS (PRIORITY 1)
**File:** Messaging module

**Integration Points to Add:**

#### 1. Customer Message Received 💬
```javascript
// When incoming message from customer
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'customer_message',
  category: 'message',
  title: 'New Customer Message',
  message: `${customerName}: "${messagePreview}"`,
  relatedId: threadId,
  relatedType: 'thread',
  metadata: { 
    customer_name: customerName, 
    phone, 
    message_preview: messagePreview 
  },
  priority: 'high', // Customers expect quick responses!
  createdBy: null // Customer-initiated
});
```

#### 2. Message Failed to Send
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'message_failed',
  category: 'message',
  title: 'Message Failed',
  message: `Failed to send message to ${customerName}`,
  relatedId: threadId,
  relatedType: 'thread',
  metadata: { customer_name: customerName, phone, error: errorMessage },
  priority: 'urgent',
  createdBy: getCurrentUser()?.id
});
```

---

### Module 6: Customers (PRIORITY 3)
**File:** Customer management module

#### 1. New Customer Added
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'customer_created',
  category: 'customer',
  title: 'New Customer Added',
  message: `${firstName} ${lastName} added to customer database`,
  relatedId: customerId,
  relatedType: 'customer',
  metadata: { customer_name: `${firstName} ${lastName}`, phone, email },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

#### 2. Vehicle Added to Customer
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'customer_vehicle_added',
  category: 'customer',
  title: 'Vehicle Added',
  message: `${vehicle} added for ${customerName}`,
  relatedId: vehicleId,
  relatedType: 'vehicle',
  metadata: { customer_name: customerName, vehicle },
  priority: 'normal',
  createdBy: getCurrentUser()?.id
});
```

---

## Implementation Order

### Week 1: Core Activity
1. ✅ Database migration (DONE)
2. ⬜ **Appointments** - All 4 integration points
3. ⬜ **Messages** - Customer message notifications

### Week 2: Financial & Jobs
4. ⬜ **Invoices** - Payment notifications (high priority)
5. ⬜ **Jobs** - Status and assignment notifications

### Week 3: Inventory & Polish
6. ⬜ **Inventory** - Low stock alerts
7. ⬜ **Customers** - New customer notifications
8. ⬜ Test all integrations

---

## Testing Checklist

After each module integration:
- [ ] Create/edit/delete item → Check notification appears
- [ ] Verify notification shows in bell icon
- [ ] Check notification count badge updates
- [ ] Verify priority badge color (normal=blue, high=orange, urgent=red)
- [ ] Test with multiple admin users
- [ ] Verify metadata is captured correctly

---

## Common Patterns

### Standard Notification Call Structure
```javascript
await createShopNotification({
  supabase: getSupabaseClient(),
  shopId: getCurrentShopId(),
  type: 'specific_event_name',
  category: 'appointment|job|invoice|inventory|message|customer',
  title: 'User-friendly title',
  message: 'Descriptive message with context',
  relatedId: recordId,
  relatedType: 'appointment|job|invoice|part|thread|customer',
  metadata: {
    // Any relevant data for filtering/searching
  },
  priority: 'normal|high|urgent',
  createdBy: getCurrentUser()?.id || null
});
```

### Priority Guidelines
- **Normal:** Standard CRUD operations, routine updates
- **High:** Payments, status completions, assignments, customer messages
- **Urgent:** Low stock alerts, critical errors, failed operations

---

## Next Steps

1. Start with **Appointments** module (use NOTIFICATION_SNIPPETS.js)
2. Test thoroughly in development
3. Move to **Messages** for customer communication alerts
4. Continue with **Invoices** for financial tracking
5. Add remaining modules as time permits

Would you like me to generate the specific integration code for any of these modules?
