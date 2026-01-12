/**
 * staff-auth.js
 * Helper for staff authentication and routing
 */

import { getSupabaseClient } from './supabase.js';

/**
 * Check if user is a staff member (not shop owner)
 * @param {string} userId - User ID to check
 * @returns {Promise<{isStaff: boolean, shopId?: string, shopName?: string}>}
 */
export async function checkStaffStatus(userId) {
    const supabase = getSupabaseClient();
    
    try {
        // First check if they're in the users table (owners/admins)
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', userId)
            .single();
            
        if (!userError && userData && (userData.role === 'admin' || userData.role === 'owner')) {
            // User is an owner/admin, not a staff member
            return { isStaff: false };
        }
        
        // Check if they're in shop_staff table
        const { data: staffRecords, error: staffError } = await supabase
            .from('shop_staff')
            .select('shop_id, role, permissions')
            .eq('auth_id', userId);
            
        if (staffError) {
            console.error('Error checking staff status:', staffError);
            return { isStaff: false };
        }
        
        if (staffRecords && staffRecords.length > 0) {
            // Get shop details for the first shop they're staff at
            const staffRecord = staffRecords[0];
            const { data: shop } = await supabase
                .from('shops')
                .select('name')
                .eq('id', staffRecord.shop_id)
                .single();
                
            return {
                isStaff: true,
                shopId: staffRecord.shop_id,
                shopName: shop?.name || 'Unknown Shop',
                role: staffRecord.role,
                permissions: staffRecord.permissions
            };
        }
        
        return { isStaff: false };
    } catch (error) {
        console.error('Error in checkStaffStatus:', error);
        return { isStaff: false };
    }
}

/**
 * Get the appropriate redirect URL based on user type
 * @param {string} userId - User ID
 * @returns {Promise<string>} - Redirect URL
 */
export async function getStaffAwareRedirect(userId) {
    const supabase = getSupabaseClient();
    
    // Check if user is staff
    const staffStatus = await checkStaffStatus(userId);
    
    if (staffStatus.isStaff) {
        // Staff members go to staff portal
        console.log('🧑‍💼 User is staff member, redirecting to staff portal');
        
        // Store staff info in session
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        session.shopId = staffStatus.shopId;
        session.isStaff = true;
        session.role = staffStatus.role;
        localStorage.setItem('xm_session', JSON.stringify(session));
        
        return 'staff-portal.html';
    }
    
    // Otherwise, check subscription for owners
    try {
        const { data: profile, error } = await supabase
            .from('users')
            .select('subscription_tier, subscription_plan, subscription_status')
            .eq('id', userId)
            .single();
            
        if (error) {
            console.error('Error fetching profile:', error);
            return 'dashboard.html';
        }
        
        const tier = (profile?.subscription_tier || profile?.subscription_plan || 'single').toLowerCase();
        const status = (profile?.subscription_status || 'inactive').toLowerCase();
        
        const validStatuses = ['active', 'trialing'];
        const multiShopTiers = ['local', 'multi'];
        
        if (validStatuses.includes(status) && multiShopTiers.includes(tier)) {
            console.log('👔 Owner with multi-shop tier, redirecting to admin');
            return 'admin.html';
        }
        
        console.log('👤 Owner with single shop, redirecting to dashboard');
        return 'dashboard.html';
        
    } catch (error) {
        console.error('Exception checking subscription:', error);
        return 'dashboard.html';
    }
}

/**
 * Check if current user has permission for an action
 * @param {string} permission - Permission to check (e.g., 'manage_inventory', 'view_reports')
 * @returns {Promise<boolean>}
 */
export async function hasPermission(permission) {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    
    // If not staff, they're an owner and have all permissions
    if (!session.isStaff) {
        return true;
    }
    
    // Check staff permissions
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return false;
    
    const { data: staffRecord } = await supabase
        .from('shop_staff')
        .select('permissions')
        .eq('auth_id', user.id)
        .eq('shop_id', session.shopId)
        .single();
        
    if (!staffRecord) return false;
    
    // Check if permission exists in permissions array
    const permissions = staffRecord.permissions || [];
    return permissions.includes(permission) || permissions.includes('*'); // * means all permissions
}

/**
 * Get current user's role in the shop
 * @returns {Promise<string>} - Role name (owner, manager, staff, etc.)
 */
export async function getCurrentRole() {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    
    if (!session.isStaff) {
        return 'owner';
    }
    
    return session.role || 'staff';
}
