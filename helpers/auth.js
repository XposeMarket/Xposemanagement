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
      // Staff member - use their first shop
      const shopId = staffShops[0].shop_id;
      session.shopId = shopId;
      localStorage.setItem('xm_session', JSON.stringify(session));
      console.log('✅ Set session shop ID from shop_staff:', shopId);
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
        shop_id: staff.shop_id
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
          shop_id: staff.shop_id
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
          // First check if this auth user maps to a shop_staff entry (prefer staff)
          const staffLike = await getStaffAsAppUser(supabase, authUser);
          if (staffLike) {
            u = staffLike;
          } else {
            const { data: byId } = await supabase.from('users').select('*').eq('id', authUser.id).limit(1);
            u = (byId && byId[0]) ? byId[0] : null;
          }
        }
      } catch (e) {
        console.warn('applyNavPermissions supabase lookup failed', e);
      }
    }
  }

  if (!u) return;
  const allowed = ROLE_PAGES[u.role] || [];
  document.querySelectorAll("header nav a").forEach(a => {
    // Always show mobile quick action buttons regardless of role
    if (a.classList && a.classList.contains('mobile-nav-btn')) {
      a.style.display = '';
      return;
    }

    const href = (a.getAttribute("href") || "").toLowerCase();
    const pn = href.replace(".html", "").replace("./", "");
    if (href && pn && !allowed.includes(pn)) {
      a.style.display = "none";
    }
  });
}

/**
 * Enforce page access - redirect if no permission
 * FIXED: Doesn't enforce for Supabase users (they're already authenticated)
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
        // Prefer shop_staff mapping if present
        console.log('  Checking shop_staff table...');
        const staffLike = await getStaffAsAppUser(supabase, authUser);
        console.log('  shop_staff result:', staffLike);
        
        if (staffLike) {
          u = staffLike;
        } else {
          console.log('  Checking users table...');
          const { data: byId } = await supabase.from('users').select('*').eq('id', authUser.id).limit(1);
          console.log('  users table result:', byId);
          u = (byId && byId[0]) ? byId[0] : null;
        }
      }
    } catch (e) {
      console.warn('enforcePageAccess supabase lookup failed', e);
    }
  }

  console.log('  Final user object:', u);
  
  if (!u) {
    console.log('  ⚠️ No user found, skipping page access enforcement');
    return;
  }
  
  const allowed = ROLE_PAGES[u.role] || [];
  const pn = pageName();
  const open = ["index", "signup", "create-shop", "admin"];
  
  console.log('  User role:', u.role);
  console.log('  Allowed pages:', allowed);
  console.log('  Current page:', pn);
  console.log('  Is page allowed?', allowed.includes(pn));
  console.log('  Is page open?', open.includes(pn));
  
  if (!allowed.includes(pn) && !open.includes(pn)) {
    console.log('  ❌ Access denied! Redirecting...');
    if (allowed.includes("dashboard")) {
      console.log('  → Redirecting to dashboard.html');
      window.location.href = "dashboard.html";
    } else {
      console.log('  → Redirecting to index.html');
      window.location.href = "index.html";
    }
  } else {
    console.log('  ✅ Access granted');
  }
}

/**
 * Require authentication
 * FIXED: Added retry logic to prevent race condition logouts
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
      return;
    }
    if (user) {
      applyNavPermissions();
      enforcePageAccess();
    }
    return;
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
      return;
    }
    
    console.log('✅ User authenticated:', user.email);
    
    // Initialize session shop ID if not already set
    await initializeSessionShopId();

    // For Supabase users, prefer mapping from `shop_staff` (if present) before loading the `users` row
    try {
      const staffLike = await getStaffAsAppUser(supabase, user);
      if (staffLike) {
        await applyNavPermissions(staffLike);
        await enforcePageAccess(staffLike);
      } else {
        try {
          const { data: userRow, error: userRowErr } = await supabase.from('users').select('*').eq('id', user.id).limit(1).single();
          if (userRowErr) {
            console.warn('Could not load users row for permission enforcement:', userRowErr);
          }
          await applyNavPermissions(userRow || null);
          await enforcePageAccess(userRow || null);
        } catch (innerErr) {
          console.warn('Permission enforcement failed fetching users row:', innerErr);
        }
      }
    } catch (permErr) {
      console.warn('Permission enforcement failed:', permErr);
    }
    
  } catch (e) {
    console.error('requireAuth failed:', e);
    const pn = pageName();
    const open = ["index", "signup", "create-shop", "admin", ""];
    if (!open.includes(pn)) {
      window.location.href = "login.html";
    }
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
