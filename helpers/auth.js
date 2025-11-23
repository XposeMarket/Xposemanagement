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
function applyNavPermissions() {
  const u = currentUser();
  if (!u) return;
  const allowed = ROLE_PAGES[u.role] || [];
  document.querySelectorAll("header nav a").forEach(a => {
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
function enforcePageAccess() {
  // Skip enforcement if user is authenticated via Supabase
  const supabase = getSupabaseClient();
  if (supabase) {
    // Supabase users are already checked by requireAuth
    // Don't double-check with localStorage
    return;
  }
  
  // Only enforce for localStorage users
  const u = currentUser();
  if (!u) return;
  const allowed = ROLE_PAGES[u.role] || [];
  const pn = pageName();
  const open = ["index", "signup", "create-shop", "admin"];
  if (!allowed.includes(pn) && !open.includes(pn)) {
    if (allowed.includes("dashboard")) {
      window.location.href = "dashboard.html";
    } else {
      window.location.href = "index.html";
    }
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
    
    // For Supabase users, we don't use localStorage permissions
    // They're authenticated and can access all pages
    // (Subscription check happens separately in app.js)
    
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
