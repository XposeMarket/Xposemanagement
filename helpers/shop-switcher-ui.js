/**
 * helpers/shop-switcher-ui.js
 * UI logic for shop switcher dropdown in header
 * FIXED: Always show admin link for Local/Multi plan users
 */

import { getCurrentUserId, getCurrentShopId, getUserShops, shouldShowAdminPage, switchShop } from './multi-shop.js';

let userShops = [];
let currentShopId = null;

/**
 * Initialize shop switcher in header
 */
async function initShopSwitcher() {
  console.log('🔄 Initializing shop switcher...');
  
  const userId = await getCurrentUserId();
  if (!userId) {
    console.log('❌ No user ID, skipping shop switcher');
    return;
  }
  
  const adminCheck = await shouldShowAdminPage(userId);
  
  if (!adminCheck.showAdmin) {
    console.log(`ℹ️ Shop switcher hidden: ${adminCheck.reason}`);
    return;
  }
  
  console.log(`✅ Shop switcher enabled: ${adminCheck.reason}, ${adminCheck.shopCount} shops`);
  
  userShops = await getUserShops(userId);
  currentShopId = getCurrentShopId();
  
  if (userShops.length === 0) {
    console.warn('⚠️ No shops found for user');
    return;
  }
  
  const shopSwitcher = document.getElementById('shopSwitcher');
  if (shopSwitcher) {
    shopSwitcher.style.display = 'flex';
  }
  
  updateCurrentShopName();
  setupShopSwitcherEvents();
  
  console.log('✅ Shop switcher initialized with', userShops.length, 'shops');
}

/**
 * Update the current shop name in the button
 */
function updateCurrentShopName() {
  const currentShopNameEl = document.getElementById('currentShopName');
  if (!currentShopNameEl) return;
  
  const currentShop = userShops.find(s => s.shop_id === currentShopId);
  if (currentShop) {
    currentShopNameEl.textContent = currentShop.shop.name || 'Unknown Shop';
  } else {
    currentShopNameEl.textContent = 'Select Shop';
  }
}

/**
 * Setup event listeners for shop switcher
 */
function setupShopSwitcherEvents() {
  const btn = document.getElementById('shopSwitcherBtn');
  const dropdown = document.getElementById('shopDropdown');
  
  if (!btn || !dropdown) return;
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');
    
    if (isHidden) {
      renderShopDropdown();
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  });
  
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
  
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

/**
 * Render shop dropdown content
 * FIXED: Always show admin link for multi-shop capable plans
 */
function renderShopDropdown() {
  const dropdown = document.getElementById('shopDropdown');
  if (!dropdown) return;
  
  const currentShop = userShops.find(s => s.shop_id === currentShopId);
  
  dropdown.innerHTML = `
    <div class="shop-dropdown-header">Currently Viewing</div>
    <div class="shop-dropdown-current">
      ${currentShop?.shop.name || 'Unknown Shop'}
    </div>
    <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--line);">
    <a href="admin.html" class="shop-dropdown-item admin-link" style="
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      color: var(--accent);
      font-weight: 600;
      text-decoration: none;
      border-radius: 6px;
      transition: background 0.2s;
      background: rgba(225, 29, 72, 0.05);
    " onmouseover="this.style.background='rgba(225, 29, 72, 0.1)'" onmouseout="this.style.background='rgba(225, 29, 72, 0.05)'">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
      <span>Admin Dashboard</span>
    </a>
    <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--line);">
    <div class="shop-dropdown-header">Switch Shop</div>
    ${userShops.map(shop => `
      <button 
        class="shop-dropdown-item ${shop.shop_id === currentShopId ? 'active' : ''}" 
        onclick="window.handleShopSwitch('${shop.shop_id}')"
        ${shop.shop_id === currentShopId ? 'disabled' : ''}
        style="
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          background: ${shop.shop_id === currentShopId ? 'var(--card-hover)' : 'transparent'};
          border: none;
          border-radius: 6px;
          cursor: ${shop.shop_id === currentShopId ? 'default' : 'pointer'};
          text-align: left;
          transition: background 0.2s;
          ${shop.shop_id === currentShopId ? 'font-weight: 600;' : ''}
        "
        ${shop.shop_id !== currentShopId ? `onmouseover="this.style.background='var(--card-hover)'" onmouseout="this.style.background='transparent'"` : ''}
      >
        <span>${shop.shop.name || 'Unknown Shop'}</span>
        <span class="shop-role" style="
          font-size: 11px;
          padding: 3px 8px;
          background: rgba(42, 124, 255, 0.1);
          color: var(--accent);
          border-radius: 10px;
          text-transform: capitalize;
        ">${shop.role}</span>
      </button>
    `).join('')}
  `;
}

/**
 * Handle shop switch
 */
async function handleShopSwitch(shopId) {
  if (shopId === currentShopId) return;
  
  console.log('🔄 Switching to shop:', shopId);
  
  const dropdown = document.getElementById('shopDropdown');
  if (dropdown) {
    dropdown.innerHTML = '<div class="shop-dropdown-loading">Switching shop...</div>';
  }
  
  const success = await switchShop(shopId);
  
  if (success) {
    console.log('✅ Shop switched successfully, reloading...');
    window.location.reload();
  } else {
    console.error('❌ Failed to switch shop');
    alert('Failed to switch shop. Please try again.');
    
    if (dropdown) {
      renderShopDropdown();
    }
  }
}

if (typeof window !== 'undefined') {
  window.handleShopSwitch = handleShopSwitch;
}

export { initShopSwitcher, handleShopSwitch };
