/**
 * helpers/multi-shop.js
 * Multi-shop management functions
 */

import { getSupabaseClient } from './supabase.js';

/**
 * Get current user ID from auth
 */
async function getCurrentUserId() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Get current shop ID from localStorage
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get all shops the user has access to
 */
async function getUserShops(userId) {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) return [];
  
  try {
    const { data, error } = await supabase
      .from('user_shops')
      .select(`
        shop_id,
        role,
        created_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching user shops:', error);
      return [];
    }
    
    if (!data || data.length === 0) return [];
    
    const shopIds = data.map(s => s.shop_id);
    const { data: shops, error: shopsError } = await supabase
      .from('shops')
      .select('id, name, type, logo, staff_limit, owner_id')
      .in('id', shopIds);
    
    if (shopsError) {
      console.error('Error fetching shop details:', shopsError);
      return [];
    }
    
    return data.map(userShop => {
      const shop = shops.find(s => s.id === userShop.shop_id);
      return {
        ...userShop,
        shop: shop || { id: userShop.shop_id, name: 'Unknown Shop' }
      };
    });
  } catch (ex) {
    console.error('Exception fetching user shops:', ex);
    return [];
  }
}

/**
 * Check if user should see admin page
 */
async function shouldShowAdminPage(userId) {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) {
    return { showAdmin: false, reason: 'no_auth', shopCount: 0 };
  }
  try {
    // Prefer shop_staff for staff users
    let user = null;
    let userError = null;
    const { data: staff, error: staffErr } = await supabase
      .from('shop_staff')
      .select('role, shop_id')
      .eq('auth_id', userId)
      .single();
    if (staff) {
      // Staff: no admin page
      return { showAdmin: false, reason: 'staff', shopCount: 0 };
    }
    // If not staff, check users table
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('subscription_plan, max_shops')
      .eq('id', userId)
      .single();
    user = userData;
    userError = userErr;
    if (userError) {
      console.error('Error fetching user data:', userError);
      return { showAdmin: false, reason: 'error', shopCount: 0 };
    }
    const userShops = await getUserShops(userId);
    const shopCount = userShops.length;
    const currentShopId = getCurrentShopId();

    // Check if user is staff (not owner)
    let isOwner = false;
    let ownerPlan = null;
    let ownerId = null;
    try {
      if (userShops && userShops.length) {
        isOwner = userShops.some(s => {
          const role = (s.role || '').toString().toLowerCase();
          if (role === 'owner' || role === 'admin') return true;
          // fallback: check shop.owner_id if present on the joined shop object
          const shopOwnerId = s.shop?.owner_id ? String(s.shop.owner_id).trim() : null;
          if (shopOwnerId && String(userId).trim() === shopOwnerId) return true;
          // If staff, capture ownerId for plan check
          if (role !== 'owner' && shopOwnerId) ownerId = shopOwnerId;
          return false;
        });
      }
      // If no userShops info matched and we have a currentShopId, fetch the shop directly
      if (!isOwner && currentShopId) {
        const { data: shop, error: shopError } = await supabase
          .from('shops')
          .select('id, owner_id')
          .eq('id', currentShopId)
          .single();
        if (!shopError && shop) {
          const shopOwnerId = shop.owner_id ? String(shop.owner_id).trim() : null;
          if (shopOwnerId && String(userId).trim() === shopOwnerId) isOwner = true;
          else if (shopOwnerId) ownerId = shopOwnerId;
        }
      }
      // If staff, check owner's plan
      if (!isOwner && ownerId) {
        const { data: owner, error: ownerError } = await supabase
          .from('users')
          .select('subscription_plan')
          .eq('id', ownerId)
          .single();
        if (!ownerError && owner) ownerPlan = owner.subscription_plan;
      }
    } catch (ex) {
      console.warn('Error while determining owner status:', ex);
    }

    const planToCheck = isOwner ? (user?.subscription_plan || '') : (ownerPlan || '');
    const hasMultiShopPlan = ['local', 'multi'].includes(String(planToCheck).toLowerCase());

    console.log('🔍 [ADMIN CHECK] Evaluation:', {
      shopCount,
      isOwner,
      hasMultiShopPlan,
      plan_lowercase: String(planToCheck).toLowerCase()
    });

    // Allow admin only if owner has local/multi plan, or user has 2+ shops
    if (isOwner && hasMultiShopPlan) {
      console.log('✅ [ADMIN CHECK] Show admin - owner with local/multi plan');
      return { showAdmin: true, reason: 'owner_local_or_multi_plan', shopCount };
    }
    if (shopCount >= 2) {
      console.log('✅ [ADMIN CHECK] Show admin - has 2+ shops');
      return { showAdmin: true, reason: 'multi_shop_access', shopCount };
    }
    // Only block if NOT owner/staff or NOT on local/multi plan
    console.log('❌ [ADMIN CHECK] Hide admin - not owner/staff or not local/multi plan');
    return { showAdmin: false, reason: 'not_owner_or_staff_local_multi', shopCount };
  } catch (ex) {
    console.error('Exception checking admin page access:', ex);
    return { showAdmin: false, reason: 'error', shopCount: 0 };
  }
}

/**
 * Check if user can create more shops
 */
async function canCreateShop(userId) {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) {
    return { canCreate: false, currentShops: 0, maxShops: 0, plan: 'none' };
  }
  
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('subscription_plan, max_shops')
      .eq('id', userId)
      .single();
    
    if (userError) {
      console.error('Error fetching user data:', userError);
      return { canCreate: false, currentShops: 0, maxShops: 0, plan: 'none' };
    }
    
    const { data: ownedShops, error: shopsError } = await supabase
      .from('user_shops')
      .select('shop_id')
      .eq('user_id', userId)
      .eq('role', 'owner');
    
    if (shopsError) {
      console.error('Error fetching owned shops:', shopsError);
      return { canCreate: false, currentShops: 0, maxShops: 0, plan: user?.subscription_plan || 'none' };
    }
    
    const currentShops = ownedShops?.length || 0;
    const maxShops = user?.max_shops || 1;
    const plan = user?.subscription_plan || 'single';
    
    return {
      canCreate: currentShops < maxShops,
      currentShops,
      maxShops,
      plan
    };
  } catch (ex) {
    console.error('Exception checking shop creation limit:', ex);
    return { canCreate: false, currentShops: 0, maxShops: 0, plan: 'none' };
  }
}

/**
 * Switch active shop
 */
async function switchShop(shopId) {
  const supabase = getSupabaseClient();
  const userId = await getCurrentUserId();
  
  if (!supabase || !userId || !shopId) {
    console.error('Cannot switch shop: missing data');
    return false;
  }
  
  try {
    const { data: access, error: accessError } = await supabase
      .from('user_shops')
      .select('shop_id')
      .eq('user_id', userId)
      .eq('shop_id', shopId)
      .single();
    
    if (accessError || !access) {
      console.error('User does not have access to this shop');
      alert('You do not have access to this shop.');
      return false;
    }
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ shop_id: shopId })
      .eq('id', userId);
    
    if (updateError) {
      console.error('Error updating active shop:', updateError);
      return false;
    }
    
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    session.shopId = shopId;
    localStorage.setItem('xm_session', JSON.stringify(session));
    
    console.log('✅ Switched to shop:', shopId);
    return true;
  } catch (ex) {
    console.error('Exception switching shop:', ex);
    return false;
  }
}

/**
 * Add user to a shop
 */
async function addUserToShop(userId, shopId, role = 'owner') {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || !shopId) return false;
  
  try {
    const { error } = await supabase
      .from('user_shops')
      .insert({
        user_id: userId,
        shop_id: shopId,
        role: role
      });
    
    if (error) {
      console.error('Error adding user to shop:', error);
      return false;
    }
    
    console.log(`✅ Added user ${userId} to shop ${shopId} as ${role}`);
    return true;
  } catch (ex) {
    console.error('Exception adding user to shop:', ex);
    return false;
  }
}

/**
 * Create a new shop for the user
 */
async function createAdditionalShop(shopName, shopType = 'Mechanic') {
  const supabase = getSupabaseClient();
  const userId = await getCurrentUserId();
  
  if (!supabase || !userId) {
    return { success: false, error: 'Not authenticated' };
  }
  
  try {
    const canCreate = await canCreateShop(userId);
    
    if (!canCreate.canCreate) {
      return {
        success: false,
        error: `You have reached your shop limit (${canCreate.currentShops}/${canCreate.maxShops}). Upgrade your plan to create more shops.`,
        shouldUpgrade: true,
        currentPlan: canCreate.plan
      };
    }
    
    const join_code = Math.random().toString(36).slice(2, 8).toUpperCase();
    
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .insert({
        name: shopName,
        type: shopType,
        join_code,
        staff_limit: 3,
        owner_id: userId
      })
      .select()
      .single();
    
    if (shopError || !shop) {
      console.error('Error creating shop:', shopError);
      return { success: false, error: 'Failed to create shop' };
    }
    
    console.log('✅ Shop created:', shop);
    
    // Ensure shop creator is assigned 'owner' role
    await addUserToShop(userId, shop.id, 'owner');
    
    const { error: dataError } = await supabase
      .from('data')
      .insert({
        shop_id: shop.id,
        settings: {},
        appointments: [],
        jobs: [],
        threads: [],
        invoices: []
      });
    
    if (dataError) {
      console.warn('⚠️ Failed to initialize shop data:', dataError);
    }
    
    return { success: true, shop };
  } catch (ex) {
    console.error('Exception creating shop:', ex);
    return { success: false, error: ex.message || 'Unknown error' };
  }
}

/**
 * Update user's max_shops based on subscription plan
 */
async function updateMaxShops(userId, subscriptionPlan) {
  const supabase = getSupabaseClient();
  if (!supabase || !userId) return false;
  
  const planLimits = {
    'single': 1,
    'local': 3,
    'multi': 6
  };
  
  const maxShops = planLimits[subscriptionPlan?.toLowerCase()] || 1;
  
  try {
    const { error } = await supabase
      .from('users')
      .update({ max_shops: maxShops })
      .eq('id', userId);
    
    if (error) {
      console.error('Error updating max_shops:', error);
      return false;
    }
    
    console.log(`✅ Updated max_shops to ${maxShops} for plan ${subscriptionPlan}`);
    return true;
  } catch (ex) {
    console.error('Exception updating max_shops:', ex);
    return false;
  }
}

export {
  getCurrentUserId,
  getCurrentShopId,
  getUserShops,
  shouldShowAdminPage,
  canCreateShop,
  switchShop,
  addUserToShop,
  createAdditionalShop,
  updateMaxShops
};
