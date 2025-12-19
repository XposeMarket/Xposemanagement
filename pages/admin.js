/**
 * pages/admin.js
 * Multi-shop admin dashboard - Fully functional
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { 
  getCurrentUserId, 
  getUserShops, 
  canCreateShop, 
  createAdditionalShop,
  switchShop,
  shouldShowAdminPage
} from '../helpers/multi-shop.js';

let userShops = [];
let shopStats = {};
let canCreate = { canCreate: false, currentShops: 0, maxShops: 0 };
let currentShopId = null;
let isSubscriptionOwner = false;

/**
 * Initialize admin page
 */
async function init() {
  console.log('🏠 Initializing Admin Dashboard...');
  
  // Use the pre-authenticated user from auth-check script
  if (!window.__adminAuthUser) {
    console.error('❌ No authenticated user available');
    window.location.href = 'login.html';
    return;
  }
  
  const userId = window.__adminAuthUser.id;
  // Wait briefly for admin eligibility to be set by `admin-auth-check.js` (it runs an async check),
  // but if it's not present we'll compute it here via `shouldShowAdminPage`.
  let adminEligible = typeof window.__adminEligible !== 'undefined' ? window.__adminEligible : null;
  if (adminEligible === null) {
    // ask the helper directly (defensive)
    try {
      const res = await shouldShowAdminPage(userId);
      adminEligible = !!res.showAdmin;
    } catch (e) {
      adminEligible = false;
    }
  }

  if (!adminEligible) {
    // Show an Access Denied modal instead of redirecting to login so user can inspect logs
    try {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed'; overlay.style.left = 0; overlay.style.top = 0; overlay.style.right = 0; overlay.style.bottom = 0;
      overlay.style.background = 'rgba(0,0,0,0.5)'; overlay.style.zIndex = 99999; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
      const modal = document.createElement('div');
      modal.style.width = '480px'; modal.style.maxWidth = '92%'; modal.style.background = '#fff'; modal.style.borderRadius = '12px'; modal.style.padding = '24px'; modal.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)'; modal.style.textAlign = 'center';

      modal.innerHTML = `
        <div style="font-size:40px">🔒</div>
        <h2 style="margin:12px 0 8px 0">Subscription Required</h2>
        <p style="color:#666; margin:0 0 16px 0">Your account does not have access to the Admin Dashboard. Please upgrade or contact the shop owner to gain access.</p>
      `;

      const btnRow = document.createElement('div'); btnRow.style.display = 'flex'; btnRow.style.gap = '10px'; btnRow.style.justifyContent = 'center'; btnRow.style.marginTop = '18px';
      const viewPlans = document.createElement('button'); viewPlans.className = 'btn primary'; viewPlans.textContent = 'View Plans'; viewPlans.addEventListener('click', () => { window.location.href = 'settings.html'; });
      const goBack = document.createElement('button'); goBack.className = 'btn'; goBack.textContent = 'Return'; goBack.addEventListener('click', () => { window.location.href = 'dashboard.html'; });
      btnRow.appendChild(viewPlans); btnRow.appendChild(goBack);
      modal.appendChild(btnRow);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    } catch (e) {
      // fallback redirect if modal can't be shown
      console.warn('Could not render access denied modal, redirecting to dashboard', e);
      window.location.href = 'dashboard.html';
    }
    return;
  }
  console.log('✅ Using authenticated user:', userId);
  
  // Get current shop from localStorage
  currentShopId = localStorage.getItem('xm_current_shop');
  
  // Load user's shops
  userShops = await getUserShops(userId);
  canCreate = await canCreateShop(userId);
  
  console.log('📊 User has', userShops.length, 'shops');
  console.log('🔒 Can create more shops?', canCreate.canCreate);
  console.log('🏢 Current shop:', currentShopId);
  
  // Determine whether this user is the subscription owner (has a subscription_plan)
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: udata, error: uerr } = await supabase
        .from('users')
        .select('id, subscription_plan')
        .eq('id', userId)
        .single();
      if (!uerr && udata) {
        isSubscriptionOwner = !!udata.subscription_plan;
      }
    }
  } catch (ex) {
    console.warn('Could not determine subscription owner status:', ex);
    isSubscriptionOwner = false;
  }
  
  // Load stats for all shops
  await loadAllShopStats();
  
  renderShops();
  renderRevenueTable();
  setupEventListeners();
  
  console.log('✅ Admin dashboard initialized');
}

/**
 * Load statistics for all shops
 */
async function loadAllShopStats() {
  const supabase = getSupabaseClient();
  
  for (const userShop of userShops) {
    const shopId = userShop.shop.id;
    
    try {
      // Fetch invoice data for the shop
      const { data: invoices, error } = await supabase
        .from('invoices')
        .select('total, status')
        .eq('shop_id', shopId);
      
      if (error) throw error;
      
      // Calculate revenue (paid invoices)
      const revenue = invoices
        .filter(inv => inv.status === 'paid')
        .reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);
      
      // Calculate trends (percentage of paid vs total)
      const totalInvoices = invoices.length;
      const paidInvoices = invoices.filter(inv => inv.status === 'paid').length;
      const trendPercent = totalInvoices > 0 
        ? Math.round((paidInvoices / totalInvoices) * 100) 
        : 0;
      
      shopStats[shopId] = {
        revenue,
        totalInvoices,
        paidInvoices,
        trendPercent
      };
    } catch (error) {
      console.error(`Error loading stats for shop ${shopId}:`, error);
      shopStats[shopId] = {
        revenue: 0,
        totalInvoices: 0,
        paidInvoices: 0,
        trendPercent: 0
      };
    }
  }
}

/**
 * Render shop cards
 */
function renderShops() {
  const shopListContainer = document.getElementById('shopList');
  if (!shopListContainer) return;
  
  shopListContainer.innerHTML = '';
  
  if (userShops.length === 0) {
    shopListContainer.innerHTML = '<p style="color: #888;">No shops found. Create your first shop!</p>';
    return;
  }
  
  userShops.forEach(userShop => {
    const shop = userShop.shop;
    const role = userShop.role;
    const stats = shopStats[shop.id] || { revenue: 0, totalInvoices: 0, paidInvoices: 0, trendPercent: 0 };
    const isActive = shop.id === currentShopId;
    
    const shopCard = document.createElement('div');
    shopCard.className = 'shop-card';
    if (isActive) {
      shopCard.style.border = '2px solid #007bff';
      shopCard.style.backgroundColor = '#f0f8ff';
    }
    
    shopCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">
            ${shop.name}
            ${isActive ? '<span style="color: #007bff; font-size: 14px; margin-left: 8px;">(Active)</span>' : ''}
          </h3>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;">
            <strong>Role:</strong> ${role}
          </div>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;">
            <strong>Revenue:</strong> $${stats.revenue.toFixed(2)}
          </div>
          <div style="color: #666; font-size: 14px;">
            <strong>Invoices:</strong> ${stats.paidInvoices}/${stats.totalInvoices} paid (${stats.trendPercent}%)
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${!isActive ? `<button class="btn primary switch-shop-btn" data-shop-id="${shop.id}">Switch to Shop</button>` : ''}
          ${role === 'owner' ? `<button class="btn danger delete-shop-btn" data-shop-id="${shop.id}">Delete Shop</button>` : ''}
        </div>
      </div>
    `;
    
    shopListContainer.appendChild(shopCard);
  });
}

/**
 * Render revenue table
 */
function renderRevenueTable() {
  const revenueTableBody = document.querySelector('#revenueTable tbody');
  const overallRevenueDiv = document.getElementById('overallRevenue');
  
  if (!revenueTableBody || !overallRevenueDiv) return;
  
  revenueTableBody.innerHTML = '';
  let totalRevenue = 0;
  
  userShops.forEach(userShop => {
    const shop = userShop.shop;
    const stats = shopStats[shop.id] || { revenue: 0, trendPercent: 0 };
    totalRevenue += stats.revenue;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${shop.name}</td>
      <td>$${stats.revenue.toFixed(2)}</td>
      <td>${stats.trendPercent}% paid</td>
    `;
    revenueTableBody.appendChild(row);
  });
  
  overallRevenueDiv.textContent = `Overall Revenue: $${totalRevenue.toFixed(2)}`;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Add Shop button
  const addShopBtn = document.getElementById('addShopBtn');
  if (addShopBtn) {
    // Only show the Add Shop button to subscription owners
    if (!isSubscriptionOwner) {
      addShopBtn.style.display = 'none';
    } else {
      addShopBtn.addEventListener('click', handleAddShop);

      // Disable if can't create more shops
      if (!canCreate.canCreate) {
        addShopBtn.disabled = true;
        addShopBtn.title = `You have reached your maximum of ${canCreate.maxShops} shops`;
        addShopBtn.style.opacity = '0.5';
        addShopBtn.style.cursor = 'not-allowed';
      }
    }
  }
  
  // Switch shop buttons
  document.querySelectorAll('.switch-shop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shopId = e.target.dataset.shopId;
      handleSwitchShop(shopId);
    });
  });
  
  // Delete shop buttons
  document.querySelectorAll('.delete-shop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shopId = e.target.dataset.shopId;
      handleDeleteShop(shopId);
    });
  });
  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
}

/**
 * Handle add shop
 */
async function handleAddShop() {
  if (!canCreate.canCreate) {
    alert(`You have reached your maximum of ${canCreate.maxShops} shops. Upgrade your plan to create more shops.`);
    return;
  }
  
  const shopName = prompt('Enter new shop name:');
  if (!shopName || shopName.trim() === '') {
    alert('Shop name is required');
    return;
  }
  
  try {
    const userId = window.__adminAuthUser.id;
    const newShop = await createAdditionalShop(userId, shopName.trim());
    
    if (newShop) {
      alert(`Shop "${shopName}" created successfully!`);
      window.location.reload(); // Reload to refresh the list
    } else {
      alert('Failed to create shop. Please try again.');
    }
  } catch (error) {
    console.error('Error creating shop:', error);
    alert(`Error creating shop: ${error.message}`);
  }
}

/**
 * Handle switch shop
 */
async function handleSwitchShop(shopId) {
  try {
    const success = await switchShop(shopId);
    
    if (success) {
      alert('Shop switched successfully! Redirecting to dashboard...');
      window.location.href = 'dashboard.html';
    } else {
      alert('Failed to switch shop. Please try again.');
    }
  } catch (error) {
    console.error('Error switching shop:', error);
    alert(`Error switching shop: ${error.message}`);
  }
}

/**
 * Handle delete shop
 */
async function handleDeleteShop(shopId) {
  const shop = userShops.find(us => us.shop.id === shopId);
  if (!shop) return;
  
  const confirmDelete = confirm(
    `Are you sure you want to delete "${shop.shop.name}"?\n\n` +
    `This will permanently delete all data associated with this shop including:\n` +
    `- All appointments\n` +
    `- All jobs\n` +
    `- All invoices\n` +
    `- All customers\n` +
    `- All messages\n\n` +
    `This action CANNOT be undone!`
  );
  
  if (!confirmDelete) return;
  
  const doubleConfirm = prompt(
    `To confirm deletion, please type the shop name exactly: "${shop.shop.name}"`
  );
  
  if (doubleConfirm !== shop.shop.name) {
    alert('Shop name did not match. Deletion cancelled.');
    return;
  }
  
  try {
    const supabase = getSupabaseClient();
    
    // Delete the shop (cascade will handle related data)
    const { error } = await supabase
      .from('shops')
      .delete()
      .eq('id', shopId);
    
    if (error) throw error;
    
    alert(`Shop "${shop.shop.name}" has been deleted successfully.`);
    
    // If we deleted the current shop, clear it and redirect to dashboard
    if (shopId === currentShopId) {
      localStorage.removeItem('xm_current_shop');
      window.location.href = 'dashboard.html';
    } else {
      window.location.reload();
    }
  } catch (error) {
    console.error('Error deleting shop:', error);
    alert(`Error deleting shop: ${error.message}`);
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Error logging out:', error);
    alert('Error logging out. Please try again.');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

export { init };
