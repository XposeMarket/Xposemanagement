/**
 * app.js - PHASE 3 (Modular Version)
 * Main Entry Point & Page Coordinator
 * FIXED: Added admin link to header for multi-shop capable users
 */

import { LS } from './helpers/constants.js';
import { readLS, writeLS, clearCache } from './helpers/storage.js';
import { currentUser, currentShop, logout, toggleTheme, setThemeFromUser } from './helpers/user.js';
import { byId, todayISO, addInvoiceCSS } from './helpers/utils.js';
import { pageName, applyNavPermissions, enforcePageAccess, requireAuth, ensureSeed, showServerBanner } from './helpers/auth.js';
import { initShopSwitcher } from './helpers/shop-switcher-ui.js';
import { 
  initializeShopConfig, 
  getCurrentTerm, 
  hasCurrentFeature,
  currentUsesVehicles,
  getCurrentIndustryType 
} from './helpers/shop-config-loader.js';
import { getSupabaseClient } from './helpers/supabase.js';
// Ensure global non-blocking notification banner is available early
import './helpers/notify.js';

// Override native alert to use the app's notification UI (non-blocking)
if (typeof window !== 'undefined') {
  try {
    window.alert = function(message){
      try {
        // Prefer the lightweight banner helper which is always available and styled
        if (typeof window.showNotificationBanner === 'function') {
          window.showNotificationBanner(message, 'error', 6000);
          return;
        }

        // Next prefer page-level showNotification
        if (typeof window.showNotification === 'function') {
          window.showNotification(message, 'error');
          return;
        }

        // If there's a global notification element used by many pages, set it directly
        const el = document.getElementById('notification');
        if (el) {
          try {
            el.textContent = message;
            el.className = 'notification';
            el.style.background = '#ef4444';
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 5000);
            return;
          } catch(e) { /* fallback */ }
        }
      } catch(e) {
        console.error('Banner alert failed:', e);
      }
    };
  } catch (e) { console.warn('Could not override window.alert', e); }
}

import { setupLogin } from './pages/index.js';
import { setupDashboard } from './pages/dashboard.js';
import { setupAppointments } from './pages/appointments.js?v=1767391500';
import { setupJobs } from './pages/jobs.js';
import { setupInvoices } from './pages/invoices.js';
import { setupMessages } from './pages/messages-backend.js';
import { setupSettings } from './pages/settings.js';
import { setupProfile } from './pages/profile.js';
import { checkSubscriptionAccess } from './helpers/subscription-check-clean.js';
import { setupInventory } from './inventory.js';

/**
 * Show styled logout confirmation modal
 */
function showLogoutConfirmModal() {
  // Remove existing modal if present
  const existing = document.getElementById('logout-confirm-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'logout-confirm-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease;
  `;
  
  modal.innerHTML = `
    <div style="
      background: var(--card, #fff);
      border-radius: 12px;
      padding: 24px;
      max-width: 380px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.2s ease;
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="
          width: 56px;
          height: 56px;
          margin: 0 auto 16px;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </div>
        <h3 style="margin: 0 0 8px; font-size: 1.25rem; color: var(--text);">Sign Out?</h3>
        <p style="margin: 0; color: var(--muted); font-size: 0.95rem;">Are you sure you want to sign out of your account?</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <button id="logout-cancel-btn" style="
          flex: 1;
          padding: 12px 16px;
          border: 1px solid var(--line);
          background: var(--bg);
          color: var(--text);
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">Cancel</button>
        <button id="logout-confirm-btn" style="
          flex: 1;
          padding: 12px 16px;
          border: none;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        ">Sign Out</button>
      </div>
    </div>
  `;
  
  // Add animation styles if not present
  if (!document.getElementById('logout-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'logout-modal-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(modal);
  
  // Handle cancel
  document.getElementById('logout-cancel-btn').onclick = () => modal.remove();
  
  // Handle confirm
  document.getElementById('logout-confirm-btn').onclick = async () => {
    const btn = document.getElementById('logout-confirm-btn');
    btn.textContent = 'Signing out...';
    btn.disabled = true;
    await logout();
  };
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  
  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/**
 * Update navigation labels based on industry configuration
 */
function updateNavigationTerminology() {
  console.log('🧭 Updating navigation terminology...');
  
  try {
    const mainNav = document.getElementById('mainNav');
    if (!mainNav) return;
    
    // Update Jobs link
    const jobsLink = mainNav.querySelector('a[href="jobs.html"]');
    if (jobsLink) {
      jobsLink.textContent = getCurrentTerm('jobs');
      console.log(`✅ Jobs → ${getCurrentTerm('jobs')}`);
    }
    
    // Update Appointments link
    const apptsLink = mainNav.querySelector('a[href="appointments.html"]');
    if (apptsLink) {
      apptsLink.textContent = getCurrentTerm('appointments');
      console.log(`✅ Appointments → ${getCurrentTerm('appointments')}`);
    }
    
    // Update Customers link
    const custsLink = mainNav.querySelector('a[href="customers.html"]');
    if (custsLink) {
      custsLink.textContent = getCurrentTerm('clients');
      console.log(`✅ Customers → ${getCurrentTerm('clients')}`);
    }
    
    // Hide inventory link if not applicable
    const inventoryLink = mainNav.querySelector('a[href="inventory.html"]');
    if (inventoryLink && !hasCurrentFeature('inventory')) {
      inventoryLink.style.display = 'none';
    } else if (inventoryLink) {
      inventoryLink.style.display = '';
    }
    
    console.log('✅ Navigation terminology updated');
  } catch (error) {
    console.error('❌ Error updating navigation:', error);
  }
}

/**
 * Initialize industry configuration for current shop
 */
async function initializeIndustryConfig() {
  console.log('🏗️ Initializing industry configuration...');
  
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const shopId = session.shopId;
    
    if (!shopId) {
      console.warn('⚠️ No shop ID found, skipping industry config');
      return;
    }
    
    const supabase = getSupabaseClient();
    const { data: shopData, error } = await supabase
      .from('shops')
      .select('*')
      .eq('id', shopId)
      .single();
    
    if (error || !shopData) {
      console.error('❌ Failed to load shop for industry config:', error);
      return;
    }
    
    console.log('🏪 Shop loaded:', shopData.name, '| Industry:', shopData.industry_type);
    
    // Initialize configuration
    initializeShopConfig(shopData);
    
    // Update navigation with industry-specific terms
    updateNavigationTerminology();
    
    console.log('✅ Industry configuration initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing industry config:', error);
  }
}
/**
 * Add admin link to navigation for multi-shop capable users
 * Shows for users with Local or Multi plans
 */
async function addAdminLinkToNav() {
  try {
    const { getUserShops, getCurrentUserId, shouldShowAdminPage } = await import('./helpers/multi-shop.js');
    const userId = await getCurrentUserId();
    if (!userId) return;
    
    // Check if user should see admin page
    const adminCheck = await shouldShowAdminPage(userId);
    
    if (!adminCheck.showAdmin) {
      console.log('ℹ️ Admin link hidden:', adminCheck.reason);
      return;
    }
    
    console.log('✅ Adding admin link to nav:', adminCheck.reason);
    
    const mainNav = document.getElementById('mainNav');
    if (mainNav && !document.getElementById('adminNavLink')) {
      const adminLink = document.createElement('a');
      adminLink.id = 'adminNavLink';
      adminLink.href = '#';
      adminLink.textContent = 'Admin';
      adminLink.style.cssText = `
        background: linear-gradient(135deg, var(--accent), #c72952);
        color: white;
        font-weight: 600;
        border-radius: 8px;
        padding: 8px 16px;
        box-shadow: 0 2px 8px rgba(225, 29, 72, 0.2);
        transition: all 0.2s;
      `;
      // Hover effect
      adminLink.addEventListener('mouseenter', () => {
        adminLink.style.transform = 'translateY(-1px)';
        adminLink.style.boxShadow = '0 4px 12px rgba(225, 29, 72, 0.3)';
      });
      adminLink.addEventListener('mouseleave', () => {
        adminLink.style.transform = 'translateY(0)';
        adminLink.style.boxShadow = '0 2px 8px rgba(225, 29, 72, 0.2)';
      });
      // Show shop switcher dropdown/modal on Admin tab click
      adminLink.addEventListener('click', async (e) => {
        e.preventDefault();
        // Remove any existing dropdown
        let existing = document.getElementById('adminShopDropdown');
        if (existing) {
          existing.remove();
          return;
        }
        // Dynamically create dropdown container
        const dropdown = document.createElement('div');
        dropdown.id = 'adminShopDropdown';
        dropdown.className = 'shop-dropdown';
        dropdown.style.position = 'absolute';
        dropdown.style.minWidth = '260px';
        dropdown.style.zIndex = '9999';
        // Mobile: full width at left 0, otherwise align to adminLink
        if (window.innerWidth < 900) {
          dropdown.style.position = 'fixed';
          dropdown.style.left = '0';
          dropdown.style.right = '0';
          dropdown.style.margin = '0 auto';
          dropdown.style.width = '90vw';
          dropdown.style.maxWidth = '420px';
          dropdown.style.top = '80px'; // fixed position below header
          dropdown.style.maxHeight = '80vh';
          dropdown.style.overflowY = 'auto';
        } else {
          dropdown.style.position = 'absolute';
          dropdown.style.top = (adminLink.offsetTop + adminLink.offsetHeight + 6) + 'px';
          dropdown.style.left = (adminLink.offsetLeft - 40) + 'px';
        }
        dropdown.style.boxShadow = '0 8px 32px rgba(0,0,0,0.18)';
        dropdown.style.background = 'var(--card, #fff)';
        dropdown.style.borderRadius = '10px';
        dropdown.style.padding = '0';
        dropdown.style.border = '1px solid var(--border, #e5e5e5)';
        // Render shop switcher UI into dropdown
        const { getCurrentUserId, getCurrentShopId, getUserShops, switchShop } = await import('./helpers/multi-shop.js');
        const userId = await getCurrentUserId();
        const userShops = await getUserShops(userId);
        const currentShopId = getCurrentShopId();
        const currentShop = userShops.find(s => s.shop_id === currentShopId);
        dropdown.innerHTML = `
          <div class="shop-dropdown-header">Currently Viewing</div>
          <div class="shop-dropdown-current">${currentShop?.shop.name || 'Unknown Shop'}</div>
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--line);">
          <a href="admin.html" class="shop-dropdown-item admin-link" style="display: flex;align-items: center;gap: 8px;padding: 10px 12px;color: var(--accent);font-weight: 600;text-decoration: none;border-radius: 6px;transition: background 0.2s;background: rgba(225, 29, 72, 0.05);" onmouseover="this.style.background='rgba(225, 29, 72, 0.1)'" onmouseout="this.style.background='rgba(225, 29, 72, 0.05)'">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span>Admin Dashboard</span>
          </a>
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--line);">
          <div class="shop-dropdown-header">Switch Shop</div>
          ${userShops.map(shop => `
            <button 
              class="shop-dropdown-item ${shop.shop_id === currentShopId ? 'active' : ''}" 
              style="width: 100%;display: flex;justify-content: space-between;align-items: center;padding: 10px 12px;background: ${shop.shop_id === currentShopId ? 'var(--card-hover)' : 'transparent'};border: none;border-radius: 6px;cursor: ${shop.shop_id === currentShopId ? 'default' : 'pointer'};text-align: left;transition: background 0.2s;${shop.shop_id === currentShopId ? 'font-weight: 600;' : ''}"
              ${shop.shop_id !== currentShopId ? `onmouseover=\"this.style.background='var(--card-hover)'\" onmouseout=\"this.style.background='transparent'\"` : ''}
              ${shop.shop_id === currentShopId ? 'disabled' : ''}
              data-shop-id="${shop.shop_id}"
            >
              <span>${shop.shop.name || 'Unknown Shop'}</span>
              <span class="shop-role" style="font-size: 11px;padding: 3px 8px;background: rgba(42, 124, 255, 0.1);color: var(--accent);border-radius: 10px;text-transform: capitalize;">${shop.role}</span>
            </button>
          `).join('')}
        `;
        // Add to DOM before scrolling
        document.body.appendChild(dropdown);
        // On mobile, scroll dropdown into view at bottom
        if (window.innerWidth < 900) {
          setTimeout(() => {
            dropdown.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }, 50);
        }
        setTimeout(() => {
          document.addEventListener('mousedown', function handler(evt) {
            if (!dropdown.contains(evt.target) && evt.target !== adminLink) {
              dropdown.remove();
              document.removeEventListener('mousedown', handler);
            }
          });
        }, 0);
        // Handle shop switch
        dropdown.querySelectorAll('button[data-shop-id]').forEach(btn => {
          btn.addEventListener('click', async (ev) => {
            const shopId = btn.getAttribute('data-shop-id');
            if (shopId === currentShopId) return;
            btn.disabled = true;
            btn.textContent = 'Switching...';
            const success = await switchShop(shopId);
            if (success) {
              window.location.reload();
            } else {
              btn.disabled = false;
              btn.textContent = (userShops.find(s => s.shop_id === shopId)?.shop.name || 'Unknown Shop');
              alert('Failed to switch shop. Please try again.');
            }
          });
        });
        // Insert dropdown into DOM
        adminLink.parentNode.appendChild(dropdown);
      });
      mainNav.appendChild(adminLink);
      console.log('✅ Admin link added to navigation');
    }
  } catch (e) {
    console.warn('Could not add admin link:', e);
  }
}

/**
 * Main initialization
 */
async function __mainBase() {
  // Seed demo data if first time
  await ensureSeed();

  // Set theme from user preference
  setThemeFromUser();

  // Theme toggle button
  if (byId("themeToggle")) {
    byId("themeToggle").addEventListener("click", toggleTheme);
  }

  // Logout button - with styled confirmation modal
  if (byId("logoutBtn")) {
    byId("logoutBtn").addEventListener("click", () => {
      showLogoutConfirmModal();
    });
  }

  // Mobile nav quick actions (forward to header handlers)
  if (byId('mobileThemeToggle')) {
    byId('mobileThemeToggle').addEventListener('click', (e) => {
      e.preventDefault();
      // call the same toggle as the header button
      toggleTheme();
    });
  }
  if (byId('mobileLogoutBtn')) {
    byId('mobileLogoutBtn').addEventListener('click', (e) => {
      e.preventDefault();
      // If mobile nav is open, close it so the confirmation modal isn't obscured
      const menuToggle = byId('menuToggle');
      const mainNav = document.getElementById('mainNav');
      if (mainNav && menuToggle && mainNav.classList.contains('active')) {
        mainNav.classList.remove('active');
        menuToggle.classList.remove('active');
      }
      showLogoutConfirmModal();
    });
  }

  // Mobile burger menu toggle
  const menuToggle = byId("menuToggle");
  const mainNav = document.getElementById("mainNav");
  if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", function () {
      mainNav.classList.toggle("active");
      menuToggle.classList.toggle("active");
    });
  }

  // Show Inventory link in header for non-staff users
  try {
    const globalInventoryLink = document.getElementById('inventoryNavLink');
    if (globalInventoryLink) {
      // Check if staff user
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          const { data: staffCheck } = await supabase
            .from('shop_staff')
            .select('role')
            .eq('auth_id', authUser.id)
            .single();
          
          // Only show inventory if NOT staff/foreman
          if (!staffCheck || (staffCheck.role !== 'staff' && staffCheck.role !== 'foreman')) {
            globalInventoryLink.style.display = '';
          } else {
            globalInventoryLink.style.display = 'none';
          }
        }
      }
    }
  } catch (e) {}

  // Add invoice CSS
  addInvoiceCSS();

  // Get current page
  const p = pageName();
  console.log('📄 Current page:', p);

  // Route to appropriate page setup
  if (p === "index" || p === "login" || p === "") {
    // Login page - no auth required
    console.log('🔐 Setting up login page');
    setupLogin();
  } else if (p === "signup") {
    // Signup page - no auth required
    console.log('📝 Setting up signup page');
    // Load the signup module dynamically
    import('./pages/signup.js').then(() => {
      console.log('✅ Signup page loaded');
    }).catch(err => {
      console.error('❌ Failed to load signup page:', err);
    });
  } else if (p === "create-shop") {
    // Create shop page - no auth required
    console.log('🏪 Setting up create-shop page');
    // Already has its own script tag, no need to load here
  } else if (p === "admin") {
    // Admin page - Simple authorization: if you can see the link, you can access the page
    // Authorization is handled by addAdminLinkToNav() which checks Local/Multi/invited status
    console.log('🏠 Setting up admin page');
    await requireAuth();
    
    // Admin page has its own module script tag, it will initialize itself
    console.log('✅ Admin page ready (access controlled by link visibility)');
    return; // Don't run subscription check for admin page
  } else {
    // All other pages require authentication
    console.log('🔒 Setting up authenticated page:', p);
    const hasPageAccess = await requireAuth();
    
    // If user doesn't have access, requireAuth already redirected - stop here
    if (!hasPageAccess) {
      console.log('🚫 Page access denied, stopping initialization');
      return;
    }
    
    // Initialize shop switcher for multi-shop users
    // Ensure demo shop exists in localStorage for demo account so UI shows settings/shop list
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const sessEmail = (session.email || '').toString().toLowerCase();
      if (sessEmail === 'demo@demo.com' || sessEmail === 'demo@demo.com') {
        try {
          const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
          if (!shops.find(s => String(s.id) === 'shop_demo')) {
            const demoShop = { id: 'shop_demo', name: 'Demo Shop', phone: '', email: 'demo@demo.com', zipcode: '', logo: '', owner_id: session.user_id || session.user?.id || null, staff_limit: 3 };
            shops.unshift(demoShop);
            localStorage.setItem('xm_shops', JSON.stringify(shops));
            console.log('[app] Seeded demo shop into localStorage for demo account');
          }
        } catch (e) { /* ignore localStorage seed failures */ }
      }
    } catch (e) {}
    await initShopSwitcher();
    
    // Add admin link to nav for multi-shop capable users
    await addAdminLinkToNav();
    
    // Initialize invitations notification system
    try {
      const { initInvitations } = await import('./helpers/invitations.js');
      await initInvitations();
    } catch (e) {
      console.warn('Could not initialize invitations:', e);
    }
    
    // Initialize invitation modal for pending invites (if any)
    try {
      import('./helpers/invitation-modal.js').then(mod => {
        if (mod && typeof mod.initInvitationModal === 'function') mod.initInvitationModal().catch(() => {});
      }).catch(() => {});
    } catch(e){}
    // Show Inventory link for non-staff authenticated users
    const inventoryLink = document.getElementById('inventoryNavLink');
    if (inventoryLink) {
      // Don't show for staff - let applyNavPermissions handle it
      // This will be handled by requireAuth -> applyNavPermissions
    }
    
    // Check subscription access (only for non-admin pages)
    const hasAccess = await checkSubscriptionAccess();
    if (!hasAccess) {
      console.log('❌ Subscription check failed');
      return; // checkSubscriptionAccess will handle redirect
    }

    // Initialize industry configuration for current shop
    await initializeIndustryConfig();

    // Setup page based on route
    if (p === "dashboard") setupDashboard();
    else if (p === "appointments") setupAppointments();
    else if (p === "jobs") setupJobs();
    else if (p === "invoices") setupInvoices();
    else if (p === "messages") setupMessages();
    else if (p === "settings") setupSettings();
    else if (p === "profile") setupProfile();
    else if (p === "inventory") {
      // Use the already imported setupInventory function
      try { 
        setupInventory(); 
        console.log('✅ Inventory page loaded'); 
      } catch (e) { 
        console.error('❌ Inventory setup failed:', e); 
      }
    }
  }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  __mainBase().catch(err => {
    console.error('App initialization failed:', err);
    showServerBanner('Failed to load app. Please refresh the page.');
  });
});

// Expose to window for debugging
window.CRM = {
  readLS,
  writeLS,
  currentUser,
  currentShop,
  pageName,
  byId,
  todayISO
};
