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
 * Delete notifications older than specified days
 * @param {object} supabase - Supabase client
 * @param {string} shopId - Shop ID
 * @param {number} daysOld - Delete notifications older than this many days (default: 7)
 */
export async function deleteOldNotifications(supabase, shopId, daysOld = 7) {
  if (!supabase || !shopId) return;
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();
    
    console.log(`[Notifications] Deleting notifications older than ${daysOld} days (before ${cutoffISO})`);
    
    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('shop_id', shopId)
      .lt('created_at', cutoffISO);
    
    if (error) {
      console.error('[Notifications] Error deleting old notifications:', error);
    } else {
      console.log(`✅ Cleaned up old notifications for shop ${shopId}`);
    }
  } catch (err) {
    console.error('[Notifications] Exception deleting old notifications:', err);
  }
}

/**
 * Create a shop notification for shop owner (from user_shops table)
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
  createdBy = null,
  recipientUserId = null
}) {
  console.log('[Notifications] Creating notification:', { shopId, type, category, title, priority, recipientUserId });
  
  if (!supabase || !shopId) {
    console.error('[Notifications] Missing required parameters', { supabase: !!supabase, shopId });
    return;
  }
  
  try {
    let targetUsers = [];
    
    // If recipientUserId is provided, send only to that specific user
    if (recipientUserId) {
      console.log('[Notifications] Targeting specific user:', recipientUserId);
      targetUsers = [{ user_id: recipientUserId }];
    } else {
      // Otherwise, send to all shop owners
      console.log('[Notifications] Fetching shop owners from user_shops for shop:', shopId);
      const { data: owners, error: ownerError } = await supabase
        .from('user_shops')
        .select('user_id')
        .eq('shop_id', shopId)
        .eq('role', 'owner');
      
      if (ownerError) {
        console.error('[Notifications] Error fetching shop owner:', ownerError);
        return;
      }
      
      console.log('[Notifications] Found shop owners:', owners);
      
      if (!owners || owners.length === 0) {
        console.warn('[Notifications] No shop owner found for shop:', shopId);
        return;
      }
      
      targetUsers = owners;
    }
    
    // Create notification for each target user
    const notifications = targetUsers.map(user => ({
      user_id: user.user_id,
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
    
    console.log('[Notifications] Inserting notifications:', notifications);
    
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
