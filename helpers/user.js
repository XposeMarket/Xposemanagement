/**
 * helpers/user.js - PHASE 2 UPDATE
 * User & Shop Management
 * Extracted from original app.js
 */

import { LS, ROLE_PAGES } from './constants.js';
import { readLS, writeLS, clearCache } from './storage.js';

/**
 * Get currently logged-in user
 */
function currentUser() {
  const session = readLS(LS.session, null);
  if (!session) return null;
  const users = readLS(LS.users, []);
  return users.find(x => x.email === session.email) || null;
}

/**
 * Get current user's subscription tier (local)
 * Returns 1, 2, or 3 (default 1)
 */
function getUserTier() {
  const user = currentUser();
  if (!user) return 1;
  return user.tier || 1;
}

/**
 * Async: Get current user's subscription tier from Supabase
 * Returns 1, 2, or 3 (default 1)
 */
async function getUserTierAsync() {
  const user = await getCurrentUser();
  if (!user) return 1;
  // If user.tier is present, use it; otherwise, fetch from profile table
  if (user.tier) return user.tier;
  if (typeof supabase !== 'undefined' && supabase) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', user.id)
        .single();
      if (data && data.tier) return data.tier;
    } catch (e) {
      console.warn('getUserTierAsync Supabase failed', e);
    }
  }
  return 1;
}

/**
 * Get current user's shop
 */
function currentShop() {
  const user = currentUser();
  const shops = readLS(LS.shops, []) || [];
  if (user) {
    return shops.find(s => s.id === user.shop_id) || shops[0] || null;
  }
  return shops[0] || null;
}

/**
 * Async version - get user from Supabase
 */
async function getCurrentUser() {
  if (typeof supabase !== 'undefined' && supabase && supabase.auth) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) return user;
    } catch (e) {
      console.warn('getCurrentUser Supabase failed', e);
    }
  }
  return currentUser();
}

/**
 * Async version - get shop from database
 */
async function getCurrentShop() {
  if (!supabase) {
    return currentShop();
  }

  const user = await getCurrentUser();
  if (!user || !user.shop_id) return null;

  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('id', user.shop_id)
    .single();

  return error ? null : data;
}

/**
 * Logout user
 */
async function logout() {
  try {
    if (typeof supabase !== 'undefined' && supabase && supabase.auth) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Supabase signOut failed', e);
      }
    }
  } catch (e) {
    console.warn('logout error', e);
  }

  try {
    localStorage.removeItem(LS.session);
  } catch (e) {
    console.warn('removeItem session failed', e);
  }

  clearCache();
  window.location.href = 'login.html';
}

/**
 * Check if user can access page
 */
function canAccessPage(pageName, user = null) {
  const u = user || currentUser();
  if (!u) return false;
  const allowed = ROLE_PAGES[u.role] || [];
  return allowed.includes(pageName);
}

/**
 * Toggle dark theme
 */

// Toggle between default (light) and theme-alt (new theme)
function toggleTheme() {
  const html = document.documentElement;
  const isAlt = html.classList.contains('theme-alt');
  let nextTheme = 'light';
  html.classList.remove('theme-alt');
  if (!isAlt) {
    html.classList.add('theme-alt');
    nextTheme = 'theme-alt';
  }
  try { localStorage.setItem('xm_theme', nextTheme); } catch (e) {}

  const u = currentUser();
  if (u) {
    const users = readLS(LS.users, []);
    const i = users.findIndex(x => x.id === u.id);
    if (i >= 0) {
      users[i].theme = nextTheme;
      writeLS(LS.users, users);
    }
  }
}

/**
 * Set theme from user preference
 */

function setThemeFromUser() {
  // Priority: explicit localStorage override -> user preference -> do nothing
  try {
    const stored = localStorage.getItem('xm_theme');
    const html = document.documentElement;
    html.classList.remove('theme-alt');
    if (stored === 'theme-alt') {
      html.classList.add('theme-alt');
      return;
    }
  } catch (e) {
    // ignore
  }
  const u = currentUser();
  if (u && u.theme) {
    const html = document.documentElement;
    html.classList.remove('theme-alt');
    if (u.theme === 'theme-alt') html.classList.add('theme-alt');
  }
}

export {
  currentUser,
  currentShop,
  getCurrentUser,
  getCurrentShop,
  logout,
  canAccessPage,
  toggleTheme,
  setThemeFromUser,
  getUserTier,
  getUserTierAsync
};
