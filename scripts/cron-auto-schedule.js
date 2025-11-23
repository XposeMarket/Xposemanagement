import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function run() {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
      process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour

    const { data: appts = [], error: fetchErr } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'new')
      .eq('source', 'platform')
      .lt('created_at', cutoff);

    if (fetchErr) throw fetchErr;

    const toTransition = appts.filter(a => (a.preferred_date || a.preferred_time));
    if (!toTransition.length) {
      console.log('No appointments to transition');
      return;
    }

    const ids = toTransition.map(a => a.id);
    const now = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('appointments')
      .update({ status: 'scheduled', updated_at: now })
      .in('id', ids);

    if (updErr) throw updErr;

    const shops = [...new Set(toTransition.map(a => a.shop_id))];
    for (const shopId of shops) {
      try {
        const { data: dataRow, error: dataErr } = await supabase
          .from('data')
          .select('appointments')
          .eq('shop_id', shopId)
          .single();
        if (dataErr) {
          console.warn('Failed to load data row for shop', shopId, dataErr);
          continue;
        }
        const apptsArr = dataRow?.appointments || [];
        let changed = false;
        const updatedAppts = apptsArr.map(a => {
          if (ids.includes(a.id) && a.status === 'new') {
            changed = true;
            return { ...a, status: 'scheduled', updated_at: now };
          }
          return a;
        });
        if (changed) {
          const { error: upsertErr } = await supabase
            .from('data')
            .upsert({ shop_id: shopId, appointments: updatedAppts, updated_at: now }, { onConflict: 'shop_id' });
          if (upsertErr) console.warn('Failed to upsert data row for shop', shopId, upsertErr);
        }
      } catch (ex) {
        console.warn('Error updating data row for shop', shopId, ex);
      }
    }

    console.log(`Transitioned ${ids.length} appointment(s) from new->scheduled`);
  } catch (err) {
    console.error('Cron run error', err);
    process.exit(1);
  }
}

run();
