/*
  scripts/update-max-shops.js
  One-time script to ensure `users.max_shops` matches subscription_plan.
  Usage: node scripts/update-max-shops.js
*/

import { getSupabaseClient } from '../helpers/supabase.js';

async function run() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase client not initialized. Ensure environment variables are set.');
    process.exit(1);
  }

  const planLimits = {
    single: 1,
    local: 3,
    multi: 6
  };

  try {
    const { data: users, error } = await supabase.from('users').select('id, subscription_plan, max_shops');
    if (error) throw error;
    if (!Array.isArray(users) || users.length === 0) {
      console.log('No users found.');
      return;
    }

    console.log(`Found ${users.length} users. Updating max_shops where needed...`);

    for (const u of users) {
      const plan = String(u.subscription_plan || 'single').toLowerCase();
      const desired = planLimits[plan] || 1;
      const current = Number(u.max_shops) || 0;
      if (current !== desired) {
        const { error: err } = await supabase.from('users').update({ max_shops: desired }).eq('id', u.id);
        if (err) {
          console.warn(`Failed updating user ${u.id}:`, err.message || err);
        } else {
          console.log(`Updated ${u.id}: max_shops ${current} -> ${desired}`);
        }
      }
    }

    console.log('Done.');
  } catch (e) {
    console.error('Error running update:', e.message || e);
    process.exit(1);
  }
}

run();
