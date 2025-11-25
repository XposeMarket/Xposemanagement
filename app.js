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
import { setupAppointments } from './pages/appointments.js';
import { setupJobs } from './pages/jobs.js';
import { setupInvoices } from './pages/invoices.js';
import { setupMessages } from './pages/messages.js';
import { setupSettings } from './pages/settings.js';
import { setupProfile } from './pages/profile.js';
import { checkSubscriptionAccess } from './helpers/subscription-check-clean.js';

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
      adminLink.href = 'admin.html';
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
    // Admin page - requires auth but NO subscription check, NO shop switcher
    console.log('🏠 Setting up admin page');
    await requireAuth();
    
    // Admin page has its own module script tag, it will initialize itself
    console.log('✅ Admin page ready');
  } else {
    // All other pages require authentication
    console.log('🔒 Setting up authenticated page:', p);
    await requireAuth();
    
    // Initialize shop switcher for multi-shop users
    await initShopSwitcher();
    
    // Add admin link to nav for multi-shop capable users
    await addAdminLinkToNav();
    
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
