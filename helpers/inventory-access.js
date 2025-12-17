// helpers/inventory-access.js
// Show Inventory nav link for admin/owner only
import { currentUser } from './helpers/user.js';

export function showInventoryNavLink() {
  const link = document.getElementById('inventoryNavLink');
  if (!link) return;
  // Show for any authenticated user (local or Supabase)
  let user = null;
  try {
    user = currentUser && currentUser();
  } catch {}
  if (user) {
    link.style.display = '';
    return;
  }
  // Try Supabase user (async)
  import('./helpers/supabase.js').then(({ getSupabaseClient }) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      if (u) link.style.display = '';
    });
  });
}
