/**
 * Create a notification for a user
 */
export async function createNotification(supabase, userId, type, title, message, relatedId = null, metadata = null) {
  if (!supabase || !userId) {
    console.error('[Invitations] ❌ Missing supabase or userId!');
    return;
  }

  console.log('[Invitations] 🔔 createNotification called:', {
    userId,
    type,
    title,
    message
  });

  try {
    const insertData = {
      user_id: userId,
      type: type,
      title: title,
      message: message,
      related_id: relatedId,
      metadata: metadata,
      is_read: false
    };
    
    console.log('[Invitations] 📤 Inserting:', insertData);
    
    const { data, error } = await supabase
      .from('notifications')
      .insert(insertData)
      .select();

    if (error) {
      console.error('[Invitations] ❌ Database error:', error);
      throw error;
    }
    
    console.log('[Invitations] ✅ Notification created successfully:', data);
    return data;
  } catch (err) {
    console.error('[Invitations] ❌ Failed:', err);
    throw err;
  }
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(supabase, notificationId) {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) throw error;
    
    console.log('[Invitations] ✅ Notification marked as read');
  } catch (err) {
    console.error('[Invitations] ❌ Error marking as read:', err);
    throw err;
  }
}
