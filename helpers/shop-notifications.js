/**
 * helpers/shop-notifications.js
 * Helper functions for shop notifications
 */

import { getSupabaseClient } from './supabase.js';

/**
 * Get icon and background color based on notification category/type
 * @param {string} category - The notification category
 * @param {string} type - The notification type
 * @returns {object} - Icon emoji and background color
 */
export function getNotificationIcon(category, type) {
  const icons = {
    // Appointments
    appointment: { icon: '📅', iconBg: '#dbeafe' },
    
    // Jobs
    job: { icon: '🔧', iconBg: '#fef3c7' },
    
    // Invoices & Financial
    invoice: { icon: '📄', iconBg: '#e0e7ff' },
    financial: { icon: '💰', iconBg: '#dcfce7' },
    
    // Inventory
    inventory: { icon: '📦', iconBg: '#fed7aa' },
    
    // Messages
    message: { icon: '💬', iconBg: '#ddd6fe' },
    
    // Staff
    staff: { icon: '👥', iconBg: '#fce7f3' },
    
    // Customer
    customer: { icon: '👤', iconBg: '#bfdbfe' },
    
    // Settings
    setting: { icon: '⚙️', iconBg: '#e5e7eb' },
    
    // Invitations
    invitation: { icon: '✉️', iconBg: '#fbcfe8' }
  };
  
  return icons[category] || { icon: '🔔', iconBg: '#f3f4f6' };
}

/**
 * Get priority badge styling
 * @param {string} priority - normal, high, urgent
 * @returns {object} - Badge text, color, and background
 */
export function getPriorityBadge(priority) {
  const badges = {
    urgent: {
      text: '🔥 Urgent',
      color: '#991b1b',
      bg: '#fee2e2'
    },
    high: {
      text: '⚠️ High',
      color: '#9a3412',
      bg: '#fed7aa'
    },
    normal: {
      text: 'Normal',
      color: '#1e40af',
      bg: '#dbeafe'
    }
  };
  
  return badges[priority] || badges.normal;
}

/**
 * Create a shop notification for all admins/owners
 * @param {object} params - Notification parameters
 */
export async function createShopNotification({
  supabase,
  shopId,
  type,
  category,
  title,
  message,
  relatedId,
  relatedType,
  metadata = {},
  priority = 'normal',
  createdBy = null
}) {
  if (!supabase || !shopId) {
    console.error('[Notifications] Missing required parameters');
    return;
  }
  
  try {
    // Get all admins/owners for this shop
    const { data: admins, error: adminError } = await supabase
      .from('shop_staff')
      .select('auth_id')
      .eq('shop_id', shopId)
      .in('role', ['owner', 'admin']);
    
    if (adminError) {
      console.error('[Notifications] Error fetching admins:', adminError);
      return;
    }
    
    if (!admins || admins.length === 0) {
      console.warn('[Notifications] No admins found for shop:', shopId);
      return;
    }
    
    // Create notification for each admin
    const notifications = admins.map(admin => ({
      user_id: admin.auth_id,
      shop_id: shopId,
      type,
      category,
      title,
      message,
      related_id: relatedId,
      related_type: relatedType,
      metadata,
      priority,
      created_by: createdBy,
      is_read: false,
      created_at: new Date().toISOString()
    }));
    
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications);
    
    if (insertError) {
      console.error('[Notifications] Error creating notifications:', insertError);
    } else {
      console.log(`✅ Created ${notifications.length} notification(s) for shop ${shopId}`);
    }
  } catch (err) {
    console.error('[Notifications] Exception creating notifications:', err);
  }
}
