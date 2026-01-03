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

  // Logout button
  if (byId("logoutBtn")) {
    byId("logoutBtn").addEventListener("click", async () => {
      await logout();
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
    byId('mobileLogoutBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      await logout();
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

  // Always show Inventory link in header when present (display across all pages)
  try {
    const globalInventoryLink = document.getElementById('inventoryNavLink');
    if (globalInventoryLink) {
      globalInventoryLink.style.display = '';
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
    await requireAuth();
    
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
    // Show Inventory link for any authenticated user (local or Supabase)
    const inventoryLink = document.getElementById('inventoryNavLink');
    if (inventoryLink) {
      let user = null;
      try {
        user = currentUser && currentUser();
      } catch {}
      if (user) {
        inventoryLink.style.display = '';
      } else {
        // Try Supabase user (async)
        import('./helpers/supabase.js').then(({ getSupabaseClient }) => {
          const supabase = getSupabaseClient();
          if (!supabase) return;
          supabase.auth.getUser().then(({ data }) => {
            const u = data?.user;
            if (u) inventoryLink.style.display = '';
          });
        });
      }
    }
    
    // Check subscription access (only for non-admin pages)
    const hasAccess = await checkSubscriptionAccess();
    if (!hasAccess) {
      console.log('❌ Subscription check failed');
      return; // checkSubscriptionAccess will handle redirect
    }

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
