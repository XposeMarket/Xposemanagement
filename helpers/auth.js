/**
 * helpers/auth.js - PHASE 2 UPDATE
 * Authentication & Authorization
 * FIXED: Added retry logic to prevent race condition logouts
 */

import { LS, ROLE_PAGES } from './constants.js';
import { readLS, writeLS } from './storage.js';
import { currentUser, currentShop } from './user.js';
import { getSupabaseClient } from './supabase.js';

/**
 * Initialize session shop ID for user
 * For staff with multiple shops, picks the first one if none is set
 */
async function initializeSessionShopId() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  
  try {
    // Check if shop ID is already in session
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    if (session.shopId) {
      console.log('✅ Shop ID already in session:', session.shopId);
      return;
    }
    // Update all staff-portal links to be labeled 'View Shop' and redirect
    // role-specifically: foreman -> dashboard, staff -> claim-board, others -> profile
    try {
      const portalLinks = document.querySelectorAll('a[href="staff-portal.html"]');
      portalLinks.forEach(el => {
        try {
          el.textContent = 'View Shop';
          if (u.role === 'foreman') el.setAttribute('href', 'dashboard.html');
          else if (u.role === 'staff') el.setAttribute('href', 'claim-board.html');
          else el.setAttribute('href', 'profile.html');
        } catch (e) { /* ignore per-element failures */ }
      });
    } catch (e) { /* ignore overall failures */ }
    
    // Get current user
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;
    
    // Check shop_staff table (for staff members)
    const { data: staffShops } = await supabase
      .from('shop_staff')
      .select('shop_id')
      .eq('auth_id', authUser.id)
      .order('created_at', { ascending: true })
      .limit(1);
    
    if (staffShops && staffShops.length > 0) {
      // Staff member - prefer a saved users.shop_id if present and the staff has access to it
      try {
        const { data: userRow, error: userRowErr } = await supabase.from('users').select('shop_id').eq('id', authUser.id).limit(1).single();
        if (!userRowErr && userRow && userRow.shop_id) {
          // verify the userRow.shop_id is among staffShops for this auth user
          const staffShopIds = (await supabase.from('shop_staff').select('shop_id').eq('auth_id', authUser.id)).data || [];
          const hasAccess = (staffShopIds || []).some(s => s.shop_id === userRow.shop_id);
          if (hasAccess) {
            session.shopId = userRow.shop_id;
            localStorage.setItem('xm_session', JSON.stringify(session));
            console.log('✅ Set session shop ID from users.shop_id (preferred for multi-shop staff):', userRow.shop_id);
            return;
          }
        }
      } catch (e) {
        console.warn('Could not read users.shop_id for preferred shop lookup', e);
      }

      // Fallback: use their first shop
      const shopId = staffShops[0].shop_id;
      session.shopId = shopId;
      localStorage.setItem('xm_session', JSON.stringify(session));
      console.log('✅ Set session shop ID from shop_staff (fallback):', shopId);
      return;
    }
    
    // Check users table (for owners)
    const { data: userData } = await supabase
      .from('users')
      .select('shop_id')
      .eq('id', authUser.id)
      .single();
    
    if (userData && userData.shop_id) {
      // Owner - use their shop_id
      session.shopId = userData.shop_id;
      localStorage.setItem('xm_session', JSON.stringify(session));
      console.log('✅ Set session shop ID from users table:', userData.shop_id);
      return;
    }
    
    // Check user_shops table (for multi-shop owners)
    const { data: userShops } = await supabase
      .from('user_shops')
      .select('shop_id')
      .eq('user_id', authUser.id)
      .order('created_at', { ascending: true })
      .limit(1);
    
    if (userShops && userShops.length > 0) {
      // Multi-shop owner - use their first shop
      const shopId = userShops[0].shop_id;
      session.shopId = shopId;
      localStorage.setItem('xm_session', JSON.stringify(session));
      console.log('✅ Set session shop ID from user_shops:', shopId);
      return;
    }
    
    console.warn('⚠️ Could not find any shop for user');
  } catch (err) {
    console.error('❌ Error initializing session shop ID:', err);
  }
}

// Helper: check if authenticated user is a shop_staff and return a normalized user-like object
async function getStaffAsAppUser(supabase, authUser){
  if(!supabase || !authUser) return null;
  try{
    // Prefer auth_id lookup, fallback to email
    const { data: byAuth, error: authErr } = await supabase.from('shop_staff').select('*').eq('auth_id', authUser.id).limit(1);
    if(!authErr && byAuth && byAuth.length > 0){
      const staff = byAuth[0];
      return {
        id: authUser.id,
        auth_id: authUser.id,
        first: staff.first_name || '',
        last: staff.last_name || '',
        email: staff.email || authUser.email,
        role: staff.role || 'staff',
        shop_id: staff.shop_id,
        shop_staff_id: staff.id,
        hourly_rate: staff.hourly_rate || 0
      };
    }
    if(authUser.email){
      const { data: byEmail, error: emailErr } = await supabase.from('shop_staff').select('*').ilike('email', authUser.email).limit(1);
      if(!emailErr && byEmail && byEmail.length > 0){
        const staff = byEmail[0];
        return {
          id: authUser.id,
          auth_id: authUser.id,
          first: staff.first_name || '',
          last: staff.last_name || '',
          email: staff.email || authUser.email,
          role: staff.role || 'staff',
          shop_id: staff.shop_id,
          shop_staff_id: staff.id,
          hourly_rate: staff.hourly_rate || 0
        };
      }
    }
  }catch(e){
    console.warn('getStaffAsAppUser failed', e);
  }
  return null;
}

/**
 * Get current page name
 */
function pageName() {
  const p = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  // Handle staff-portal specifically
  if (p === "staff-portal.html" || p === "staff-portal") {
    return "staff-portal";
  }
  return p.replace(".html", "");
}

/**
 * Check if user can access page
 */
function canAccessPage(page, user = null) {
  const u = user || currentUser();
  if (!u) return false;
  const allowed = ROLE_PAGES[u.role] || [];
  return allowed.includes(page);
}

/**
 * Hide nav links user can't access
 */
async function applyNavPermissions(userRow = null) {
  // Hide nav links user can't access. Accepts an optional user record (from Supabase users table).
  let u = userRow || currentUser();

  // If no local user and supabase is available, try to fetch the users row for the authenticated user
  if (!u) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
            // Prefer the canonical `users` row (owners/admins) when present. Only fall back
            // to `shop_staff` mapping if no `users` record exists for this auth user.
            try {
              const { data: byId } = await supabase.from('users').select('*').eq('id', authUser.id).limit(1);
              if (byId && byId[0]) {
                u = byId[0];
              } else {
                const staffLike = await getStaffAsAppUser(supabase, authUser);
                if (staffLike) u = staffLike;
              }
            } catch (e) {
              // Fall back to shop_staff mapping on any error
              const staffLike = await getStaffAsAppUser(supabase, authUser);
              if (staffLike) u = staffLike;
            }
        }
      } catch (e) {
        console.warn('applyNavPermissions supabase lookup failed', e);
      }
    }
  }

  if (!u) return;
  const supabase = getSupabaseClient();
  // If staff-like (staff or foreman), prefer shop-specific shop_staff row for role/hourly_rate using session shopId
  let isHourlyForShop = false;
  let shopStaffFound = false;
  try {
    if (u && (u.role === 'staff' || u.role === 'foreman') && supabase) {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const curShopId = session.shopId || null;
      if (curShopId) {
        try {
          // Try to resolve a shop_staff row for the current session shop. Prefer auth_id, but
          // fall back to email-based lookup (some legacy staff rows lack auth_id).
          const lookupUser = { id: u.auth_id || u.id, email: u.email };
          const staffLike = await getStaffAsAppUser(supabase, lookupUser);
          console.log('  shop_staff lookup (getStaffAsAppUser) result:', staffLike);
          if (staffLike && Number(staffLike.shop_id) === Number(curShopId)) {
            u.hourly_rate = staffLike.hourly_rate || u.hourly_rate || 0;
            u.role = staffLike.role || u.role;
            u.shop_id = staffLike.shop_id || u.shop_id;
            u.shop_staff_id = staffLike.shop_staff_id || u.shop_staff_id;
            isHourlyForShop = Number(u.hourly_rate || 0) > 0;
            shopStaffFound = true;
          } else {
            // As a final fallback, try a direct auth_id query scoped to the shop (keeps previous behavior)
            if (u.auth_id || u.id) {
              const { data: ssRow, error: ssErr } = await supabase.from('shop_staff').select('*').eq('shop_id', curShopId).eq('auth_id', u.auth_id || u.id).limit(1).single();
              console.log('  shop_staff direct query result:', ssRow, 'error:', ssErr);
              if (!ssErr && ssRow) {
                u.hourly_rate = ssRow.hourly_rate || u.hourly_rate || 0;
                u.role = ssRow.role || u.role;
                u.shop_id = ssRow.shop_id || u.shop_id;
                u.shop_staff_id = ssRow.id || u.shop_staff_id;
                isHourlyForShop = Number(u.hourly_rate || 0) > 0;
                shopStaffFound = true;
              }
            }
          }
        } catch (e) {
          console.warn('applyNavPermissions: could not fetch shop_staff for session shop', e);
        }
      }
    }
  } catch (e) {
    console.warn('applyNavPermissions: could not fetch shop_staff for session shop', e);
  }
  // Copy allowed pages so we don't mutate the shared ROLE_PAGES constant.
  const allowed = Array.isArray(ROLE_PAGES[u.role]) ? ROLE_PAGES[u.role].slice() : [];
  const isStaff = (u.role === 'staff' || u.role === 'foreman');
  // If staff and we found a shop_staff row for the current shop but they're not hourly,
  // remove staff-portal from allowed set for nav visibility. If we couldn't determine
  // shop-specific status, leave the staff-portal visible by default.
  if (isStaff && shopStaffFound && !isHourlyForShop) {
    const idx = allowed.indexOf('staff-portal');
    if (idx !== -1) allowed.splice(idx, 1);
  }
  
  console.log('🔒 Applying nav permissions for role:', u.role);
  console.log('  Allowed pages (before shop check):', allowed);
  console.log('  Is staff member:', isStaff);
  console.log('  shopStaffFound:', shopStaffFound, 'isHourlyForShop:', isHourlyForShop);
  
  // Handle CSS class-based navigation visibility (for pages like profile.html)
  if (isStaff) {
    // Hide owner-only navigation links by default, but allow Dashboard for `foreman`.
    document.querySelectorAll('.owner-nav').forEach(el => {
      try {
        const href = (el.getAttribute && el.getAttribute('href')) ? el.getAttribute('href') : '';
        if (u.role === 'foreman' && href === 'dashboard.html') {
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      } catch (e) {
        el.style.display = 'none';
      }
    });
    // Show or hide staff-only navigation links based on whether staff is hourly for this shop.
    // If we couldn't determine shop-specific status, show staff-only links.
    document.querySelectorAll('.staff-only-nav').forEach(el => {
      el.style.display = (shopStaffFound ? (isHourlyForShop ? '' : 'none') : '');
    });
    // Update brand link: if we know the shop-specific payment type, choose accordingly.
    const brandLink = document.getElementById('brandLink');
    if (brandLink) {
      // Foreman should land on dashboard by default unless they're hourly staff
      if (u.role === 'foreman') {
        brandLink.href = (shopStaffFound && isHourlyForShop) ? 'staff-portal.html' : 'dashboard.html';
      } else {
        brandLink.href = (shopStaffFound ? (isHourlyForShop ? 'staff-portal.html' : 'profile.html') : 'staff-portal.html');
      }
    }
    // Show foreman-only nav links if applicable
    if (u.role === 'foreman') {
      document.querySelectorAll('.foreman-nav').forEach(el => el.style.display = '');
    } else {
      document.querySelectorAll('.foreman-nav').forEach(el => el.style.display = 'none');
    }
    // Additional UI tweaks for Foremen accessing the Dashboard: hide actions/panels they shouldn't use
    if (u.role === 'foreman') {
      try {
        // Hide quick-create buttons under the Dashboard title
        ['#btnNewAppt', '#btnNewInv', '#btnNewCust'].forEach(sel => {
          const el = document.querySelector(sel);
          if (el) { el.style.display = 'none'; console.log('  Hiding dashboard quick-action:', sel); }
        });

        // Hide the Open Invoices card (left sidebar) by finding the heading link to invoices
        const invHeadingLink = document.querySelector('h3 a[href="invoices.html"]');
        if (invHeadingLink) {
          const invCard = invHeadingLink.closest('.card');
          if (invCard) { invCard.style.display = 'none'; console.log('  Hiding Open Invoices card'); }
        } else {
          // Fallback: hide element with id openInvoicesList
          const openList = document.getElementById('openInvoicesList');
          if (openList) { const card = openList.closest('.card'); if (card) { card.style.display = 'none'; console.log('  Hiding Open Invoices card (fallback)'); } }
        }

        // Hide Quick Stats panel
        const quickStats = document.getElementById('quickStatsCard');
        if (quickStats) { quickStats.style.display = 'none'; console.log('  Hiding Quick Stats card'); }

        // Hide Revenue Trend card (use revenueChart element to locate card)
        const revCanvas = document.getElementById('revenueChart');
        if (revCanvas) {
          const revCard = revCanvas.closest('.card');
          if (revCard) { revCard.style.display = 'none'; console.log('  Hiding Revenue Trend card'); }
        } else {
          // fallback: hide any card with header text containing 'Revenue Trend'
          Array.from(document.querySelectorAll('.card')).forEach(c => {
            const h = c.querySelector('h3');
            if (h && (h.textContent || '').toLowerCase().includes('revenue')) { c.style.display = 'none'; console.log('  Hiding Revenue card (fallback)'); }
          });
        }
        // Move the "Appointments Today" card to the right sidebar for foremen
        try {
          const apptList = document.getElementById('appointmentsTodayList');
          const apptCard = apptList ? apptList.closest('.card') : null;
          const rightSidebar = document.querySelector('.right-sidebar');
          if (apptCard && rightSidebar && !rightSidebar.contains(apptCard)) {
            // Insert at top of right sidebar
            rightSidebar.insertBefore(apptCard, rightSidebar.firstElementChild || null);
            console.log('  Moved Appointments Today card to right sidebar for foreman');
          }
        } catch (e) { console.warn('applyNavPermissions: failed to move Appointments Today card to right sidebar', e); }
        // Show claim board jobs card if present and trigger a render
        try {
          const claimCard = document.getElementById('claimBoardJobsCard');
          if (claimCard) {
            claimCard.style.display = '';
            console.log('  Showing Claim Board Jobs card for foreman');
          }
          if (window.renderClaimBoardJobs && typeof window.renderClaimBoardJobs === 'function') {
            try { window.renderClaimBoardJobs(); } catch (e) { console.warn('Failed to call renderClaimBoardJobs', e); }
          }
        } catch (e) { console.warn('applyNavPermissions: failed to show/refresh Claim Board Jobs card', e); }
      } catch (e) {
        console.warn('applyNavPermissions: failed to hide dashboard-only panels for foreman', e);
      }
    }
    else {
      // If not a foreman, ensure the Appointments Today card is back in the left sidebar
      try {
        const apptList = document.getElementById('appointmentsTodayList');
        const apptCard = apptList ? apptList.closest('.card') : null;
        const leftSidebar = document.querySelector('.left-sidebar');
        if (apptCard && leftSidebar && !leftSidebar.contains(apptCard)) {
          // Place it at the end of left sidebar (after active jobs)
          leftSidebar.appendChild(apptCard);
          console.log('  Moved Appointments Today card back to left sidebar');
        }
      } catch (e) { /* ignore */ }
    }
  } else {
    // Show owner navigation, hide staff-only links
    document.querySelectorAll('.owner-nav').forEach(el => {
      el.style.display = '';
    });
    document.querySelectorAll('.staff-only-nav').forEach(el => {
      el.style.display = 'none';
    });
  }
  
  // Handle href-based navigation visibility (for other pages)
  document.querySelectorAll("header nav a").forEach(a => {
    // Always show mobile quick action buttons regardless of role
    if (a.classList && a.classList.contains('mobile-nav-btn')) {
      a.style.display = '';
      return;
    }
    
    // Skip elements with owner-nav or staff-only-nav classes (already handled above)
    if (a.classList && (a.classList.contains('owner-nav') || a.classList.contains('staff-only-nav'))) {
      return;
    }

    const href = (a.getAttribute("href") || "").toLowerCase();
    const pn = href.replace(".html", "").replace("./", "");
    // Normalize link page name
    let linkPage = pn;
    
    // Special handling for inventory - hide from staff
    if (pn === 'inventory' && isStaff) {
      console.log('  Hiding inventory from staff');
      a.style.display = 'none';
      return;
    }
    
    if (href && linkPage && !allowed.includes(linkPage)) {
      console.log(`  Hiding ${linkPage} (not in allowed list)`);
      a.style.display = "none";
    } else {
      // Make sure allowed pages are visible
      if (href && linkPage && allowed.includes(linkPage)) {
        a.style.display = '';
      }
    }
  });
}

/**
 * Enforce page access - redirect if no permission
 * Returns true if access granted, false if redirecting
 */
async function enforcePageAccess(userRow = null) {
  // Enforce page access. If a userRow (from Supabase) is provided, use it; otherwise fall back to localStorage.
  const supabase = getSupabaseClient();
  let u = userRow || currentUser();
  
  console.log('🔐 enforcePageAccess called');
  console.log('  userRow:', userRow);
  console.log('  currentUser():', currentUser());

  // If we don't have a local user and Supabase is available, try fetching the users row
  if (!u && supabase) {
    try {
      console.log('  Fetching Supabase user...');
      const { data: { user: authUser } } = await supabase.auth.getUser();
      console.log('  Supabase authUser:', authUser?.email);
      
      if (authUser) {
        // Prefer the canonical `users` row (owners/admins) when present. Only fall back
        // to `shop_staff` mapping if no `users` record exists for this auth user.
        try {
          console.log('  Checking users table...');
          const { data: byId } = await supabase.from('users').select('*').eq('id', authUser.id).limit(1);
          console.log('  users table result:', byId);
          if (byId && byId[0]) {
            u = byId[0];
          } else {
            console.log('  Checking shop_staff table...');
            const staffLike = await getStaffAsAppUser(supabase, authUser);
            console.log('  shop_staff result:', staffLike);
            if (staffLike) u = staffLike;
          }
        } catch (e) {
          // On error, fall back to shop_staff mapping
          console.log('  users table check failed, falling back to shop_staff');
          const staffLike = await getStaffAsAppUser(supabase, authUser);
          if (staffLike) u = staffLike;
        }
      }
    } catch (e) {
      console.warn('enforcePageAccess supabase lookup failed', e);
    }
  }

  console.log('  Final user object:', u);
  
  if (!u) {
    console.log('  ⚠️ No user found, skipping page access enforcement');
    return true; // Allow access if we can't determine user
  }
  
  const allowed = ROLE_PAGES[u.role] || [];
  const pn = pageName();
  const open = ["index", "signup", "create-shop", "admin", "staff-portal"];
  
  console.log('  User role:', u.role);
  console.log('  Allowed pages:', allowed);
  console.log('  Current page:', pn);
  console.log('  Is page allowed?', allowed.includes(pn));
  console.log('  Is page open?', open.includes(pn));
  
    if (!allowed.includes(pn) && !open.includes(pn)) {
      console.log('  ❌ Access denied! Redirecting...');
      // If the user is a staff record, only force staff-portal for HOURLY staff (use session-specific hourly_rate)
      let isHourlyStaff = false;
      try {
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        const curShopId = session.shopId || null;
        if (u && u.role === 'staff' && curShopId) {
          const { data: ssRow } = await getSupabaseClient().from('shop_staff').select('hourly_rate').eq('auth_id', u.auth_id || u.id).eq('shop_id', curShopId).limit(1).single();
          isHourlyStaff = Number(ssRow?.hourly_rate || 0) > 0;
        }
      } catch (e) {
        console.warn('enforcePageAccess: could not determine hourly status for staff', e);
      }

      if (isHourlyStaff && allowed.includes("staff-portal")) {
        console.log('  → Redirecting hourly staff to staff-portal.html');
        window.location.href = "staff-portal.html";
      } else if (allowed.includes("dashboard")) {
        console.log('  → Redirecting to dashboard.html');
        window.location.href = "dashboard.html";
      } else {
        console.log('  → Redirecting to index.html');
        window.location.href = "index.html";
      }
      return false; // Access denied
    } else {
    console.log('  ✅ Access granted');
    return true; // Access granted
  }
}

/**
 * Require authentication
 * Returns true if authenticated and has access, false if redirecting
 */
async function requireAuth() {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    console.warn('Supabase not available, using localStorage only');
    const user = currentUser();
    const pn = pageName();
    const open = ["index", "signup", "create-shop", "admin", ""];
    if (!user && !open.includes(pn)) {
      window.location.href = "index.html";
      return false;
    }
    if (user) {
      await applyNavPermissions();
      const hasAccess = await enforcePageAccess();
      return hasAccess;
    }
    return true;
  }

  try {
    // RETRY LOGIC - prevent race condition logout
    let user = null;
    let retries = 3;
    let lastError = null;
    
    while (retries > 0 && !user) {
      try {
        const { data, error } = await supabase.auth.getUser();
        
        if (data?.user) {
          user = data.user;
          break;
        }
        
        if (error) {
          lastError = error;
          console.warn(`⚠️ Auth check attempt ${4-retries} failed:`, error);
        }
      } catch (e) {
        lastError = e;
        console.warn(`⚠️ Auth check attempt ${4-retries} threw exception:`, e);
      }
      
      retries--;
      if (retries > 0) {
        console.log(`⏳ Retrying auth check... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms before retry
      }
    }
    
    const pn = pageName();
    const open = ["index", "signup", "create-shop", "admin", ""];
    
    if (!user) {
      console.log('❌ No authenticated user after retries, redirecting to login');
      if (lastError) {
        console.error('Last auth error:', lastError);
      }
      if (!open.includes(pn)) {
        window.location.href = "login.html";
      }
      return false;
    }
    
    console.log('✅ User authenticated:', user.email);
    
    // Initialize session shop ID if not already set
    await initializeSessionShopId();

    // For Supabase users, prefer mapping from `shop_staff` (if present) before loading the `users` row
    try {
      const staffLike = await getStaffAsAppUser(supabase, user);
      if (staffLike) {
        await applyNavPermissions(staffLike);
        const hasAccess = await enforcePageAccess(staffLike);
        return hasAccess;
      } else {
        try {
          const { data: userRow, error: userRowErr } = await supabase.from('users').select('*').eq('id', user.id).limit(1).single();
          if (userRowErr) {
            console.warn('Could not load users row for permission enforcement:', userRowErr);
          }
          await applyNavPermissions(userRow || null);
          const hasAccess = await enforcePageAccess(userRow || null);
          return hasAccess;
        } catch (innerErr) {
          console.warn('Permission enforcement failed fetching users row:', innerErr);
          return true; // Allow access on error
        }
      }
    } catch (permErr) {
      console.warn('Permission enforcement failed:', permErr);
      return true; // Allow access on error
    }
    
  } catch (e) {
    console.error('requireAuth failed:', e);
    const pn = pageName();
    const open = ["index", "signup", "create-shop", "admin", ""];
    if (!open.includes(pn)) {
      window.location.href = "login.html";
    }
    return false;
  }
}

/**
 * Seed demo data
 */
function __ensureSeedBase() {
  if (readLS(LS.seeded, false)) return;

  const today = new Date().toISOString().slice(0, 10);

  writeLS(LS.users, [
    {
      id: "u1",
      first: "Owner",
      last: "User",
      email: "owner@demo.local",
      password: "admin123",
      role: "admin",
      shop_id: "s1"
    }
  ]);

  writeLS(LS.shops, [
    {
      id: "s1",
      name: "Demo Shop",
      type: "Mechanic",
      join_code: "ABCD12",
      staff_limit: 3
    }
  ]);

  writeLS(LS.data, {
    settings: {
      shop: { name: "Demo Shop", phone: "", email: "" },
      services: [
        { id: 'svc_1', name: 'Oil Change', price: 45, parts_price: 15, labor_rate: 75, hours: 0.5, shop_id: 's1' },
        { id: 'svc_2', name: 'Brake Inspection', price: 60, parts_price: 0, labor_rate: 85, hours: 1, shop_id: 's1' }
      ],
      labor_rates: [
        { name: "Standard", rate: 120, shop_id: 's1' },
        { name: "Premium", rate: 150, shop_id: 's1' }
      ]
    },
    appointments: [
      {
        id: "a1",
        created_at: new Date().toISOString(),
        customer_first: "Evan",
        customer_last: "Ramos",
        email: "evan.ramos@example.com",
        phone: "(301) 555-0182",
        vehicle: "2014 BMW 335i",
        vin: "WBADT43452G208320",
        service: "Brake inspection",
        preferred_date: today,
        preferred_time: "10:00",
        status: "scheduled",
        source: "inquiry",
        shop_id: "s1",
        notes: "Grinding noise on front left"
      }
    ],
    jobs: [
      { id: "J1001", appointment_id: "a1", status: "scheduled", shop_id: "s1" }
    ],
    threads: [
      {
        id: "t1",
        type: "inquiry",
        title: "New Inquiry · Evan Ramos",
        meta: {
          name: "Evan Ramos",
          phone: "(301) 555-0182",
          email: "evan.ramos@example.com",
          vehicle: "2014 BMW 335i",
          service: "Brake inspection",
          date: today,
          time: "10:00",
          notes: "Grinding noise on front left"
        },
        messages: [
          {
            from: "system",
            body: "New inquiry submitted from website.",
            created_at: new Date().toISOString()
          }
        ],
        shop_id: "s1"
      }
    ],
    invoices: [
      {
        id: "inv1001",
        number: "1001",
        customer: "Evan Ramos",
        appointment_id: "a1",
        status: "open",
        due: today,
        tax_rate: 6,
        discount: 0,
        items: [
          { name: "Labor", qty: 1, price: 120 },
          { name: "Parts", qty: 1, price: 45 }
        ],
        shop_id: "s1"
      }
    ]
  });

  writeLS(LS.seeded, true);
}

/**
 * Public wrapper for seed
 */
function ensureSeed() {
  return __ensureSeedBase();
}

/**
 * Show server/error banner
 */
function showServerBanner(msg) {
  try {
    const text = msg || 'Our servers are temporarily unavailable. Please try again later.';
    let b = document.getElementById('serverBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'serverBanner';
      b.style.position = 'fixed';
      b.style.top = '0';
      b.style.left = '0';
      b.style.right = '0';
      b.style.zIndex = '9999';
      b.style.background = 'linear-gradient(90deg,#fffbeb,#fff1f2)';
      b.style.color = '#111827';
      b.style.padding = '10px 16px';
      b.style.textAlign = 'center';
      b.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
      b.style.fontWeight = '600';
      b.style.fontSize = '14px';
      b.style.cursor = 'pointer';
      b.addEventListener('click', () => { b.remove(); });
      document.body.appendChild(b);
    }
    b.textContent = text;
    setTimeout(() => { b?.remove(); }, 12000);
  } catch (e) {
    // ...existing code...
  }
}

export {
  pageName,
  canAccessPage,
  applyNavPermissions,
  enforcePageAccess,
  requireAuth,
  ensureSeed,
  showServerBanner
};
