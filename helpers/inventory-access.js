// helpers/inventory-access.js
// Show Inventory nav link only for owners/admins (hide for staff/foreman)
import { currentUser } from './user.js';
import { getSupabaseClient } from './supabase.js';

export async function showInventoryNavLink() {
  const link = document.getElementById('inventoryNavLink');
  if (!link) return;

  // If local currentUser indicates a role, use it
  try {
    const local = (typeof currentUser === 'function') ? currentUser() : null;
    if (local && local.role && local.role !== 'staff' && local.role !== 'foreman') {
      link.style.display = '';
      return;
    }
    if (local && (local.role === 'staff' || local.role === 'foreman')) {
      link.style.display = 'none';
      return;
    }
  } catch (e) {
    // ignore and fallback to Supabase
  }

  // Fallback: check Supabase auth + shop_staff role
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      link.style.display = 'none';
      return;
    }

    // Try to find a shop_staff row for this auth user. If found and role is staff/foreman, hide link.
    try {
      const { data: staffRow, error } = await supabase.from('shop_staff').select('role').eq('auth_id', authUser.id).limit(1).single();
      if (!error && staffRow) {
        if (staffRow.role === 'staff' || staffRow.role === 'foreman') {
          link.style.display = 'none';
          return;
        }
      }
    } catch (e) {
      // ignore and allow link below
    }

    // If we reach here, we couldn't determine a staff/foreman role — show link
    link.style.display = '';
  } catch (e) {
    // On error, hide to be safe
    try { link.style.display = 'none'; } catch (er) {}
  }
}
