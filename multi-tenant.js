// Clean, single multi-tenant script (no duplicates)
(function(){
  if(!window.readLS || !window.writeLS) return;

  const LS_KEYS = { users: 'xm_users', session: 'xm_session', data: 'xm_data', shops: 'xm_shops' };

  // Diagnostic helpers: wrap fetch and log global errors so we can capture
  // failing network calls from the Supabase UMD SDK (e.g. OAuth token exchange).
  try{
    if(typeof window !== 'undefined' && !window.__xm_fetch_diagnostic_wrapped){
      const _origFetch = window.fetch.bind(window);
      window.fetch = async function(input, init){
        try{
          const res = await _origFetch(input, init);
          if(!res.ok){
            // Log non-2xx responses for easier debugging
            console.warn('[fetch-diagnostic] non-ok response', { url: input, status: res.status, statusText: res.statusText, options: init });
          }
          return res;
        }catch(err){
          // Log the failing request details (URL, body omitted if huge)
          try{ console.error('[fetch-diagnostic] fetch failed', { url: input, options: init, error: (err && err.message) || err }); }catch(e){}
          throw err;
        }
      };
      window.__xm_fetch_diagnostic_wrapped = true;
    }
  }catch(e){ /* ignore */ }

  // Global error hooks to capture unhandled promise rejections and errors
  try{
    if(typeof window !== 'undefined' && !window.__xm_error_hooks_installed){
      window.addEventListener('unhandledrejection', function(ev){
        try{ console.error('[unhandledrejection]', ev.reason); }catch(e){}
      });
      window.addEventListener('error', function(ev){
        try{ console.error('[global error]', ev.message, ev.filename, ev.lineno, ev.colno, ev.error); }catch(e){}
      });
      window.__xm_error_hooks_installed = true;
    }
  }catch(e){ /* ignore */ }

  // Helper: wait for window.supabase to become available (reduces race conditions)
  async function waitForSupabase({ timeout = 5000, poll = 200 } = {}){
    if(typeof window === 'undefined') return null;
    if(window.supabase) return window.supabase;
    if(typeof window.initSupabase === 'function'){
      try{ window.initSupabase(); }catch(e){ /* ignore */ }
    }
    const deadline = Date.now() + timeout;
    while(Date.now() < deadline){
      if(window.supabase) return window.supabase;
      await new Promise(r => setTimeout(r, poll));
    }
    return null;
  }

  // Helper: wait for the Supabase auth user to be present (useful for FK races)
  async function waitForAuthUser(sup, expectedId = null, { timeout = 15000, poll = 500 } = {}){
    if(!sup || !sup.auth) return null;
    const deadline = Date.now() + timeout;
    while(Date.now() < deadline){
      try{
        const res = await sup.auth.getUser();
        const uid = res?.data?.user?.id || null;
        if(uid && (!expectedId || uid === expectedId)) return uid;
      }catch(e){ /* ignore transient errors */ }
      await new Promise(r => setTimeout(r, poll));
    }
    return null;
  }

  function getUsers(){ return readLS(LS_KEYS.users, []) || [] }
  function setUsers(v){ writeLS(LS_KEYS.users, v || []) }
  function getSession(){ return readLS(LS_KEYS.session, null) }
  function getData(){ return readLS(LS_KEYS.data, { settings: {}, appointments: [], jobs: [], threads: [], invoices: [] }) }
  function setData(v){ writeLS(LS_KEYS.data, v || {}) }
  function getShops(){ return readLS(LS_KEYS.shops, []) || [] }
  function setShops(v){ writeLS(LS_KEYS.shops, v || []) }
  function uid(p){ return (p||'id') + Math.random().toString(36).slice(2,8) }

  // Create or upsert an app user (Supabase first, local fallback)
  async function createAppUser({ userId=null, first='', last='', email='', role='staff', shop_id=null, zipcode='' }={}){
    // local helper for fallback
    function localCreate(){
      const usersLocal = getUsers();
      if(usersLocal.some(u => u.email === email)) return { ok:false, error: 'Email already in use (local).' };
      const id = userId || uid('u_');
      const row = { id, first, last, email, password: '', role, shop_id, zipcode };
      if(userId) row.auth_id = userId;
      usersLocal.push(row);
      setUsers(usersLocal);
      return { ok:true, id, local:true };
    }

    // Wait for Supabase client (centralized, avoids scattered race loops)
    const sup = await waitForSupabase({ timeout: 5000, poll: 200 });
    if(!sup) return localCreate();

    try{
      // If no userId provided try to get currently signed in user
      if(!userId){
        try{ const res = await sup.auth.getUser(); userId = res?.data?.user?.id || userId; }catch(e){ /* ignore */ }
      }

      // If we have a userId, ensure the auth user exists (wait a bit if necessary)
      if(userId){
        const found = await waitForAuthUser(sup, userId, { timeout: 15000, poll: 500 });
        if(!found){
          console.warn('createAppUser: auth user not present after wait, falling back to local');
          const local = localCreate();
          return { ok: local.ok, id: local.id, local:true, error: 'Auth user not present (timed out)', details: null };
        }
      }

      // Build payload for upsert
      const payload = { first, last, email, role, shop_id };
      if(userId) payload.auth_id = userId;
      if(zipcode) payload.zipcode = zipcode;
      const upsertObj = Object.keys(payload).reduce((acc,k)=>{ if(typeof payload[k] !== 'undefined') acc[k]=payload[k]; return acc; }, {});

      // Try upsert and handle FK race (23503) by waiting longer and retrying
      let { data, error } = await sup.from('users').upsert([upsertObj]).select();

      if(error){
        // If FK violation (auth row not present yet), wait and retry once
        if(String(error.code) === '23503'){
          console.warn('createAppUser upsert FK violation (23503). Waiting for auth user and retrying...');
          try{
            await waitForAuthUser(sup, userId, { timeout: 15000, poll: 500 });
            const retry = await sup.from('users').upsert([upsertObj]).select();
            data = retry.data; error = retry.error;
          }catch(re){
            console.warn('Retry after FK wait failed', re);
            error = re || error;
          }
        }
        // If still error (or different error), try fallback with explicit id
        if(error){
          try{
            const fallbackId = userId || uid('u_');
            const fallbackObj = Object.assign({ id: fallbackId }, upsertObj);
            const retry2 = await sup.from('users').upsert([fallbackObj]).select();
            data = retry2.data; error = retry2.error;
          }catch(re2){
            console.warn('Fallback upsert with id also failed', re2);
            error = error || re2;
          }
        }
      }

      if(error){
        console.warn('createAppUser upsert failed', error);
        const local = localCreate();
        return { ok: local.ok, id: local.id, local:true, error: (error && error.message) || String(error), details: error };
      }

      // get id: prefer returned app-user id from DB, otherwise fallback to a generated id
      const id = (Array.isArray(data) && data[0] && data[0].id) || (data && data.id) || userId || uid('u_');
      return { ok:true, id, local:false, data };
    }catch(ex){
      console.warn('createAppUser error, falling back to local', ex);
      const local = localCreate();
      return { ok: local.ok, id: local.id, local:true, error: ex && ex.message ? ex.message : String(ex), details: ex };
    }
  }

  // seed demo shop if none
  (function(){ const shops = getShops(); if(shops.length) return; const sid = 's1'; setShops([{ id: sid, name: 'Demo Shop', type: 'Mechanic', join_code: 'ABCD12', staff_limit: 3 }]); const users = getUsers(); if(users.length){ users[0].role = users[0].role || 'admin'; users[0].shop_id = users[0].shop_id || sid; setUsers(users); } const d = getData(); ['appointments','jobs','threads','invoices'].forEach(k => { d[k] = (d[k]||[]).map(x => ({ shop_id: sid, ...x })); }); setData(d); })();

  // helpers
  function currentUser(){ const s = getSession(); if(!s || !s.email) return null; return getUsers().find(u => u.email === s.email) || null }
  function currentShop(){ const u = currentUser(); if(!u || !u.shop_id) return getShops()[0] || null; return getShops().find(s => s.id === u.shop_id) || null }

  // Sync localStorage from Supabase if available (helps when LS was cleared)
  // New syncLocalFromSupabase function
  async function syncLocalFromSupabase(){
    try{
      console.log('syncLocalFromSupabase: starting...');
      const sup = await waitForSupabase({ timeout: 10000, poll: 500 });
      if(!sup) {
        console.warn('syncLocalFromSupabase: Supabase not available');
        return;
      }

      // Get current user's shop
      const { data: { user } } = await sup.auth.getUser();
      if (!user) return;

      const { data: userRecord } = await sup.from('users').select('shop_id').eq('auth_id', user.id).single();
      const shopId = userRecord?.shop_id;
      if (!shopId) return;

      // Fetch all shop data in parallel
      const [
        { data: shops },
        { data: users },
        { data: appointments },
        { data: jobs },
        { data: invoices },
        { data: threads },
        { data: shopSettings }
      ] = await Promise.all([
        sup.from('shops').select('*'),
        sup.from('users').select('*'),
        sup.from('appointments').select('*').eq('shop_id', shopId),
        sup.from('jobs').select('*').eq('shop_id', shopId),
        sup.from('invoices').select('*').eq('shop_id', shopId),
        sup.from('threads').select('*').eq('shop_id', shopId),
        sup.from('shop_data').select('*').eq('shop_id', shopId).single()
      ]);

      // Only write if local is empty
      if (shops?.length && !getShops().length) {
        setShops(shops);
        console.log('✅ Shops synced');
      }
      
      if (users?.length && !getUsers().length) {
        setUsers(users);
        console.log('✅ Users synced');
      }

      // Merge all data
      const d = getData() || {};
      if (appointments?.length) d.appointments = appointments;
      if (jobs?.length) d.jobs = jobs;
      if (invoices?.length) d.invoices = invoices;
      if (threads?.length) d.threads = threads;
      if (shopSettings?.settings) d.settings = shopSettings.settings;

      if (Object.keys(d).length > 0) {
        setData(d);
        console.log('✅ All shop data synced');
      }

      // Set session if needed
      const sess = getSession();
      if ((!sess || !sess.email) && users?.length) {
        const admin = users.find(u => u.role === 'admin') || users[0];
        if (admin?.email) {
          writeLS(LS_KEYS.session, { email: admin.email, at: Date.now() });
          console.log('✅ Session set for', admin.email);
        }
      }

      console.log('syncLocalFromSupabase: completed successfully');
    } catch(e) { 
      console.warn('syncLocalFromSupabase: error', e); 
    }
  }

  // lifecycle
  document.addEventListener('DOMContentLoaded', function() {
    (async function() {
      // attempt to seed localStorage from Supabase; expose a promise so other modules can await it
      try {
        let shopId = null;
        // Try to get shopId from session or localStorage
        const sess = window.readLS ? readLS(LS_KEYS.session, {}) : {};
        if(sess && sess.shop_id) shopId = sess.shop_id;
        if(!shopId && window.readLS) {
          const shops = readLS(LS_KEYS.shops, []);
          if(Array.isArray(shops) && shops.length) shopId = shops[0].id || shops[0].shop_id;
        }
        if(shopId) {
          window._syncShopPromise = syncShopDataFromSupabase(shopId).catch(e => { console.warn('syncShopDataFromSupabase error', e); });
          window._syncShopDataFromSupabase = syncShopDataFromSupabase;
        } else {
          console.warn('No shopId found for syncShopDataFromSupabase');
        }
      }catch(e){}
      const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
      if(page === 'settings.html') enhanceSettings();
      if(page === 'create-shop.html') initCreateShop();
      if(page === 'signup.html') enhanceSignup();
      if(page === 'index.html') enhanceLogin();
      attachGoogleButtons();
    })();
  });

  function enhanceLogin(){
    document.getElementById('btnCreateAccount')?.addEventListener('click', e => { e.preventDefault(); location.assign('signup.html'); });
    document.getElementById('btnCreateShop')?.addEventListener('click', e => { e.preventDefault(); location.assign('create-shop.html'); });
  }

  async function enhanceSettings(){
    try {
      const main = document.querySelector('main.container') || document.querySelector('main');
      if(!main) return;

      // ...existing code...
      const u = currentUser();
      let shop = currentShop();
      if(!shop){
        const shops = getShops();
        shop = (Array.isArray(shops) && shops.length) ? shops[0] : null;
      }
      if(!shop) {
        console.warn('[multi-tenant] enhanceSettings: no shop found — inserting fallback team panel');
        // ...existing code...
        try{ injectFallbackTeamCard(main); }catch(e){ console.warn('injectFallbackTeamCard failed', e); }
        return; // still no shop-specific data, stop further processing
      }

      // Admin controls only when we have an admin user
      const canAdmin = !!(u && u.role === 'admin');

      // ...existing code...
    const card = document.createElement('div'); card.className = 'card'; card.style.marginTop = '16px';
    card.innerHTML = `
      <h2>Shop Access & Team</h2>
      <div class="grid cols-3">
        <div>
          <label>Shop Type</label>
          <select id="setShopType" ${canAdmin?"":"disabled"}>
            <option ${shop?.type==="Mechanic"?"selected":""}>Mechanic</option>
            <option ${shop?.type==="Body"?"selected":""}>Body</option>
            <option ${shop?.type==="Other"?"selected":""}>Other</option>
          </select>
        </div>
        <div>
          <label>Staff Limit</label>
          <input id="setStaffLimit" type="number" min="1" value="${shop?.staff_limit||3}" ${canAdmin?"":"disabled"}>
        </div>
        <div>
          <label>Join Code</label>
          <div style="position:relative;">
            <input id="setJoinCode" value="${shop?.join_code||""}" readonly style="padding-right:40px;">
            <button id="btnCopyJoin" class="btn" type="button" title="Copy join code" style="position:absolute; right:5px; top:50%; transform:translateY(-50%); width:24px; height:24px; padding:0; display:flex; align-items:center; justify-content:center; border:none; background:none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 1H4C3 1 2 2 2 3V17H4V3H16V1Z" fill="currentColor"/>
                <path d="M15 5H8C7 5 6 6 6 7V21C6 22 7 23 8 23H20C21 23 22 22 22 21V11C22 10 21 9 20 9H17V7C17 6 16 5 15 5ZM20 21H8V7H15V11H20V21Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
          <div style="margin-top:8px;">
            <button id="btnRegenerateJoin" class="btn" type="button">Regenerate Code</button>
          </div>
        </div>
      </div>
      <div style="margin-top:16px">
        <h3>Staff List</h3>
        <table class="table" id="staffTable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody></tbody></table>
        <p class="notice">Slots used: <span id="slotsUsed">0</span> / <span id="slotsMax">${shop?.staff_limit||3}</span></p>
      </div>
    `;
  main.appendChild(card);

    const all = getUsers().filter(x => x.shop_id === (shop && shop.id));
    // Also fetch staff from shop_staff table
    let staffMembers = [];
    try {
      const sup = await waitForSupabase();
      if (sup) {
        const { data: staffData, error: staffErr } = await sup.from('shop_staff').select('*').eq('shop_id', shop.id);
        if (!staffErr && staffData) {
          staffMembers = staffData.map(s => ({
            id: s.id,
            first: s.first_name,
            last: s.last_name,
            email: s.email,
            role: s.role,
            shop_id: s.shop_id,
            is_staff: true // flag to distinguish from users table
          }));
        }
      }
    } catch (ex) {
      console.warn('Failed to fetch staff from Supabase:', ex);
    }
    // Combine admins and staff and dedupe by email (prefer local users entries when duplicates exist)
    const combined = [...all, ...staffMembers];
    const emailMap = new Map();
    combined.forEach(u => {
      const key = (u.email || '').toLowerCase();
      if(!emailMap.has(key)){
        emailMap.set(key, u);
      } else {
        // If duplicate, prefer the local `users` entry (which won't have is_staff flag)
        const existing = emailMap.get(key);
        if(existing.is_staff && !u.is_staff){
          emailMap.set(key, u);
        }
        // if both exist or both staff, keep existing
      }
    });
    const allTeamMembers = Array.from(emailMap.values());
  const tbody = card.querySelector('#staffTable tbody');
  let used = 0;
  allTeamMembers.forEach(us => {
      if(us.role !== 'admin') used++;
      const tr = document.createElement('tr');

      // Name cell
      const tdName = document.createElement('td');
      tdName.textContent = `${us.first} ${us.last}`;
      tr.appendChild(tdName);

      // Email cell
      const tdEmail = document.createElement('td');
      tdEmail.textContent = us.email;
      tr.appendChild(tdEmail);

      // Role cell (select for admins, text for others)
      const tdRole = document.createElement('td');
      if(canAdmin){
        const select = document.createElement('select');
        select.className = 'roleSel';
        select.setAttribute('data-uid', us.id);
        const roles = ['admin','service_writer','receptionist','staff'];
        roles.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r;
          opt.textContent = r;
          if(us.role === r) opt.selected = true;
          select.appendChild(opt);
        });
        tdRole.appendChild(select);
      } else {
        tdRole.textContent = us.role;
      }
      tr.appendChild(tdRole);

      // Actions cell
      const tdActions = document.createElement('td');
      if(canAdmin && us.id !== u.id){
        const btn = document.createElement('button');
        btn.className = 'btn danger';
        btn.setAttribute('data-remove', us.id);
        btn.textContent = 'Remove';
        tdActions.appendChild(btn);
      }
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
    card.querySelector('#slotsUsed').textContent = String(used);

    // If there are no team members, show a helpful row so the panel is visible
    if (!allTeamMembers.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No team members found for this shop.</td></tr>';
    }

    // ...existing code...

    if(canAdmin){
      tbody.querySelectorAll('.roleSel').forEach(sel => {
        sel.addEventListener('change', async () => {
          const uid = sel.getAttribute('data-uid');
          const user = allTeamMembers.find(u => u.id === uid);
          if (!user) return;
          
          if (user.is_staff) {
            // Update role in shop_staff table
            try {
              const sup = await waitForSupabase();
              if (sup) {
                const { error: updateErr } = await sup.from('shop_staff').update({ role: sel.value }).eq('id', uid);
                if (updateErr) {
                  console.warn('Failed to update staff role:', updateErr);
                  return;
                }
              }
            } catch (ex) {
              console.warn('Failed to update staff role:', ex);
              return;
            }
          } else {
            // Update role in local users table
            const users = getUsers(); const i = users.findIndex(x => x.id === uid); if(i >= 0){ users[i].role = sel.value; setUsers(users); }
          }
        });
      });
      tbody.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.getAttribute('data-remove');
          const user = allTeamMembers.find(u => u.id === uid);
          if (!user) return;
          
          if(!confirm('Remove this user from your shop? Their active jobs will be unassigned.')) return;
          
          if (user.is_staff) {
            // Remove from shop_staff table
            try {
              const sup = await waitForSupabase();
              if (sup) {
                const { error: deleteErr } = await sup.from('shop_staff').delete().eq('id', uid);
                if (deleteErr) {
                  console.warn('Failed to remove staff:', deleteErr);
                  return;
                }
              }
            } catch (ex) {
              console.warn('Failed to remove staff:', ex);
              return;
            }
          } else {
            // Remove from local users table
            const users = getUsers(); const i = users.findIndex(x => x.id === uid); if(i < 0) return;
            const d = getData(); (d.jobs || []).forEach(j => { if(j.assigned_to === uid) j.assigned_to = null; }); setData(d);
            users[i].shop_id = null; setUsers(users);
          }
          location.reload();
        });
      });
      card.querySelector('#setStaffLimit').addEventListener('change', (e) => {
        const shops = getShops(); const si = shops.findIndex(s => s.id === shop.id); if(si >= 0){ shops[si].staff_limit = Math.max(1, parseInt(e.target.value || '3', 10)); setShops(shops); card.querySelector('#slotsMax').textContent = String(shops[si].staff_limit); }
      });
      card.querySelector('#setShopType').addEventListener('change', (e) => {
        const shops = getShops(); const si = shops.findIndex(s => s.id === shop.id); if(si >= 0){ shops[si].type = e.target.value; setShops(shops); }
      });
      // copy join code
      const copyBtn = card.querySelector('#btnCopyJoin');
      const joinInput = card.querySelector('#setJoinCode');
      if(copyBtn && joinInput){
        copyBtn.addEventListener('click', async () => {
          try{
            const text = (joinInput.value || '').toString();
            if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); }
            else { joinInput.select(); document.execCommand('copy'); }
            const prev = copyBtn.textContent; copyBtn.textContent = 'Copied!'; setTimeout(()=> copyBtn.textContent = prev, 1500);
          }catch(ex){ console.warn('Copy failed', ex); alert('Could not copy join code.'); }
        });
      }

      // regenerate join code (ensures uniqueness across shops)
      const regenBtn = card.querySelector('#btnRegenerateJoin');
      if(regenBtn && joinInput){
        regenBtn.addEventListener('click', async () => {
          if(!confirm('Generate a new join code for this shop? Existing codes will no longer work.')) return;
          // generate unique code
          function gen(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
          const shops = getShops(); let code; let tries = 0;
          do{ code = gen(); tries++; if(tries > 50) break; } while(shops.some(s => String(s.join_code||'').toUpperCase() === code));
          joinInput.value = code;
          // try Supabase update first (use waitForSupabase to avoid race)
          const sup = await waitForSupabase({ timeout: 5000, poll: 200 });
          if(sup){
            try{
              const { data, error } = await sup.from('shops').update({ join_code: code }).eq('id', shop.id).select().single();
              if(error){ console.warn('Supabase join code update failed', error); throw error; }
              // update local copy too
              const shopsLocal = getShops(); const si = shopsLocal.findIndex(s => s.id === shop.id); if(si >= 0){ shopsLocal[si].join_code = code; setShops(shopsLocal); }
              regenBtn.textContent = 'Saved'; setTimeout(()=> regenBtn.textContent = 'Regenerate Code', 1500);
              return;
            }catch(ex){ console.warn('Supabase update failed, falling back to local:', ex); }
          }
          // fallback to local
          const shopsLocal = getShops(); const si = shopsLocal.findIndex(s => s.id === shop.id); if(si >= 0){ shopsLocal[si].join_code = code; setShops(shopsLocal); }
          regenBtn.textContent = 'Saved'; setTimeout(()=> regenBtn.textContent = 'Regenerate Code', 1500);
        });
      }
    }
    } catch (ex) {
        console.error('[multi-tenant] enhanceSettings error', ex);
      }
    }

  function enhanceSignup(){
    if(window._signup_initialized) return; window._signup_initialized = true;
    const form = document.getElementById('signupForm'); if(!form) return;
    const allJoins = form.querySelectorAll('#suJoin'); if(allJoins.length > 1){ for(let i=1;i<allJoins.length;i++) allJoins[i].remove(); }
    if(!form.querySelector('#suJoin')){
      const joinLabel = document.createElement('label'); joinLabel.textContent = 'Shop Join Code';
      const join = document.createElement('input'); join.id = 'suJoin'; join.placeholder = 'Enter join code'; join.required = true;
      form.insertBefore(join, form.firstChild); form.insertBefore(joinLabel, join);
    }
    const err = document.getElementById('signupErr');
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      console.log('signup: form submitted');
      const first = (document.getElementById('suFirst')||{}).value||'';
      const last = (document.getElementById('suLast')||{}).value||'';
      const email = (document.getElementById('suEmail')||{}).value||'';
      const pass = (document.getElementById('suPass')||{}).value||'';
      const code = (document.getElementById('suJoin')||{}).value.trim().toUpperCase();
      console.log('signup: collected data', { first, last, email, code: code.substring(0,3)+'...' });

      // attempt Supabase first (wait for client to reduce race conditions)
      const sup = await waitForSupabase({ timeout: 5000, poll: 200 });
      console.log('signup: Supabase client available?', !!sup);
      if(sup){
        try{
          console.log('signup: checking shop with join code');
          const { data: shopsResp, error: shopErr } = await sup.from('shops').select('*').ilike('join_code', code).limit(1);
          if(shopErr){ console.warn('Supabase shop check failed:', shopErr); throw new Error('Could not validate join code.'); }
          const shop = (shopsResp && shopsResp[0]) ? shopsResp[0] : null;
          console.log('signup: shop found?', !!shop, shop?.id);
          if(!shop){ throw new Error('Invalid join code.'); }

          // Insert staff into shop_staff table
          console.log('signup: inserting staff into shop_staff');
          const { data: staffData, error: staffErr } = await sup.from('shop_staff').insert({
            shop_id: shop.id,
            first_name: first,
            last_name: last,
            email,
            role: 'staff'
          }).select();
          if(staffErr){
            console.warn('Supabase shop_staff insert failed:', staffErr);
            if(staffErr.message && staffErr.message.includes('duplicate')){
              throw new Error('Email already in use for this shop.');
            }
            throw staffErr;
          }
          console.log('signup: shop_staff insert success:', staffData);

          writeLS(LS_KEYS.session, { email, at: Date.now() });
          // Redirect disabled to preserve page state for debugging; session saved.
          console.log('signup: session saved (redirect disabled)');
          return;
        }catch(ex){
          console.warn('Supabase signup failed, falling back to local:', ex);
          if(err) err.textContent = ex.message || 'Signup failed, trying local fallback.';
        }
      }

      // local fallback
      const shopsLocal = getShops(); const shopLocal = shopsLocal.find(s => String(s.join_code||'').toUpperCase() === code);
      if(!shopLocal){ if(err) err.textContent = 'Invalid join code.'; return; }
      const usersLocal = getUsers(); if(usersLocal.some(u => u.email === email)){ if(err) err.textContent = 'Email already in use.'; return; }
  usersLocal.push({ id: uid('u_'), first, last, email, password: pass, role: 'staff', shop_id: shopLocal.id }); setUsers(usersLocal); writeLS(LS_KEYS.session, { email, at: Date.now() });
  console.log('signup: local session saved (redirect disabled)');
    }, { once: false });
  }

  async function initCreateShop(){
    const form = document.getElementById('createShopForm'); const err = document.getElementById('csErr'); if(!form) return;
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      const shopName = document.getElementById('csName').value.trim();
      const shopType = document.getElementById('csType').value.trim();
      const shopLogoFile = document.getElementById('csLogo')?.files?.[0];
      const first = document.getElementById('csFirst').value.trim();
      const last = document.getElementById('csLast').value.trim();
      const email = document.getElementById('csEmail').value.trim();
      const passField = document.getElementById('csPass');
      let pass = passField ? passField.value.trim() : '';
      const zipcode = document.getElementById('csZipcode').value.trim();

      // If Google OAuth is active, disable password field (try briefly to detect client)
      let isGoogleOAuth = false;
      try{
        const supCheck = await waitForSupabase({ timeout: 2000, poll: 200 });
        if(supCheck){
          try{
            const sessRes = await supCheck.auth.getSession();
            const session = sessRes?.data?.session || null;
            if (session && session.user && session.user.app_metadata?.provider === 'google') {
              isGoogleOAuth = true;
              if (passField) {
                passField.required = false;
                passField.disabled = true;
                passField.style.background = '#eee';
                passField.value = '';
                if (passField.previousElementSibling) passField.previousElementSibling.style.color = '#aaa';
              }
              pass = '';
            }
          }catch(e){ /* ignore */ }
        }
      }catch(e){ /* ignore */ }

      let shopLogo = '';
      if(shopLogoFile){ shopLogo = await new Promise(resolve => { const reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.readAsDataURL(shopLogoFile); }); }

      // attempt Supabase then fallback to local
      try{
        const sup = await waitForSupabase({ timeout: 5000, poll: 200 });
        if(sup){
          const join_code = Math.random().toString(36).slice(2,8).toUpperCase();
          const shopInsert = { name: shopName, type: shopType, join_code, staff_limit: 3 };
          if(shopLogo) shopInsert.logo = shopLogo;
          const { data: shopData, error: shopErr } = await sup.from('shops').insert([shopInsert]).select().single();
          if(shopErr || !shopData){ if(err) err.textContent = (shopErr && shopErr.message) || 'Could not create shop.'; throw shopErr || new Error('no shop'); }
          // create user (use helper which has Supabase + local fallback)
          let userId = null;
          let created = null;
          if(isGoogleOAuth){
            // create/upsert app user for current Google-authenticated user
            created = await createAppUser({ userId: null, first, last, email, role: 'admin', shop_id: shopData.id, zipcode });
            userId = created.id || null;
          } else {
            // perform auth sign-up for email/password then create app user
            const { data: signData, error: signErr } = await sup.auth.signUp({ email, password: pass, options: { data: { first: first, last: last, zipcode: zipcode, role: 'admin' } } });
            if(signErr){ if(err) err.textContent = signErr.message || 'Could not create user.'; throw signErr; }
            userId = signData?.user?.id || null;
            created = await createAppUser({ userId, first, last, email, role: 'admin', shop_id: shopData.id, zipcode });
          }
          if(!created || !created.ok){
            console.warn('Could not create/upsert app user for shop admin', created && created.error);
            showServerBanner('User create failed: ' + (created && created.error ? created.error : 'unknown'));
            // If we weren't able to create the app user in Supabase and did not create a local fallback, abort and surface error
            if(!(created && created.local)){
              if(err) err.textContent = 'Could not create admin user. Please try again.';
              return; // stop flow so admin isn't left without linkage
            }
          }
          if(created && created.local && created.error){ showServerBanner('Supabase unavailable — admin created locally: ' + created.error); }
          try{ await sup.from('data').upsert({ shop_id: shopData.id, settings: { shop: { name: shopName, phone: '', email: '', logo: shopLogo } } }); }catch(e){ console.warn('could not upsert data', e); }
          writeLS(LS_KEYS.session, { email, at: Date.now() }); /* setTimeout(() => location.href = 'settings.html', 10); */ /* Debug log removed */ return;
        }
      }catch(ex){ console.warn('Supabase create-shop failed, falling back to localStorage', ex); }

      // local fallback
      const shopsLocal = getShops(); const shopId = uid('shop_'); const join_code = Math.random().toString(36).slice(2,8).toUpperCase(); const shop = { id: shopId, name: shopName, type: shopType, logo: shopLogo, join_code, staff_limit: 3 }; shopsLocal.push(shop); setShops(shopsLocal);
      const usersLocal = getUsers(); if(usersLocal.some(u => u.email === email)){ if(err) err.textContent = 'Email already in use.'; return; }
      const admin = { id: uid('u_'), first, last, email, password: pass, zipcode, role: 'admin', shop_id: shopId }; usersLocal.push(admin); setUsers(usersLocal);
  const dataLocal = getData(); dataLocal.settings = dataLocal.settings || {}; dataLocal.settings.shop = { ...(dataLocal.settings.shop||{}), name: shopName, logo: shopLogo||'', type: shopType, shop_id: shopId }; setData(dataLocal); writeLS(LS_KEYS.session, { email: admin.email, at: Date.now() }); /* location.href = 'settings.html'; */ /* Debug log removed */
    });
  }

  // Google OAuth helpers
  function handleGoogleSignup(role = 'staff', shopId = null){ if(!window.supabase){ console.warn('Supabase not available for Google signup, retrying...'); setTimeout(()=> handleGoogleSignup(role, shopId), 500); return; } const options = { provider: 'google', options: { redirectTo: window.location.origin + '/dashboard.html' } }; if(role === 'staff' && shopId) options.options.redirectTo += `?shop_id=${shopId}&role=staff`; else if(role === 'admin') options.options.redirectTo += `?role=admin`; window.supabase.auth.signInWithOAuth(options).catch(error => console.warn('Google signup failed:', error)); }

  function handleGoogleCreateShop(){ if(!window.supabase){ console.warn('Supabase not available for Google create shop, retrying...'); setTimeout(()=> handleGoogleCreateShop(), 500); return; } const options = { provider: 'google', options: { redirectTo: window.location.origin + '/create-shop.html?oauth=google' } }; window.supabase.auth.signInWithOAuth(options).catch(error => console.warn('Google create shop failed:', error)); }

  function attachGoogleButtons(){
    try {
      // Signup page Google button
      if(window.location.pathname.endsWith('signup.html')) {
        const googleSignupBtn = document.getElementById('googleSignupBtn');
        if(googleSignupBtn){
          googleSignupBtn.addEventListener('click', function(){
            const joinCode = document.getElementById('suJoin')?.value?.trim()?.toUpperCase();
            if(!joinCode){ document.getElementById('signupErr').textContent = 'Please enter a shop join code first.'; return; }
            const shops = getShops();
            const shop = shops.find(s => String(s.join_code||'').toUpperCase() === joinCode);
            if(!shop){ document.getElementById('signupErr').textContent = 'Invalid join code.'; return; }
            handleGoogleSignup('staff', shop.id);
          });
        }
      }
      // Create shop page Google button
      if(window.location.pathname.endsWith('create-shop.html')) {
        const googleCreateShopBtn = document.getElementById('googleCreateShopBtn');
        if(googleCreateShopBtn) googleCreateShopBtn.addEventListener('click', handleGoogleCreateShop);
      }
      // Index page Google login button (safeguard against undefined)
      if(window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        const googleLoginBtn = document.getElementById('googleLoginBtn');
        if(googleLoginBtn && window.supabase) {
          googleLoginBtn.addEventListener('click', function(){
            window.supabase.auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo: window.location.origin + '/dashboard.html' }
            }).catch(error => console.warn('Google login failed:', error));
          });
        }
      }
    } catch(e) {
      console.warn('Error in attachGoogleButtons:', e);
    }
  }


// Fallback injector: creates a minimal Team / Join Code panel when no shop is available (safe, local-only)
function injectFallbackTeamCard(main){
  if(!main) return;
  if(main.querySelector('#xm-team-card')) return; // already present

  const shops = getShops();
  const shop = (Array.isArray(shops) && shops.length) ? shops[0] : { id: 'local-demo', name: 'Local Shop', join_code: '', staff_limit: 3, type: '' };

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'xm-team-card';
  card.style.marginTop = '16px';
  card.innerHTML = `
    <h2>Shop Access & Team (Fallback)</h2>
    <div class="grid cols-3">
      <div>
        <label>Shop Type</label>
        <input id="xm-setShopType" value="${shop.type||''}" disabled>
      </div>
      <div>
        <label>Staff Limit</label>
        <input id="xm-setStaffLimit" type="number" min="1" value="${shop.staff_limit||3}" disabled>
      </div>
      <div>
        <label>Join Code</label>
        <div style="position:relative;">
          <input id="xm-setJoinCode" value="${shop.join_code||''}" readonly style="padding-right:40px;">
          <button id="xm-btnCopyJoin" class="btn" type="button" title="Copy join code" style="position:absolute; right:5px; top:50%; transform:translateY(-50%); width:24px; height:24px; padding:0; border:none; background:none;">Copy</button>
        </div>
        <div style="margin-top:8px;">
          <button id="xm-btnRegenerateJoin" class="btn" type="button">Regenerate Code</button>
        </div>
      </div>
    </div>
    <div style="margin-top:16px">
      <h3>Staff List</h3>
      <table class="table" id="xm-staffTable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody></tbody></table>
      <p class="notice">Slots used: <span id="xm-slotsUsed">0</span> / <span id="xm-slotsMax">${shop.staff_limit||3}</span></p>
    </div>
  `;

  main.appendChild(card);

  // populate staff from local users
  try{
    const tbody = card.querySelector('#xm-staffTable tbody');
    const users = getUsers().filter(u => u.shop_id === shop.id);
    if(!users.length){
      tbody.innerHTML = '<tr><td colspan="4" class="muted">No team members (fallback)</td></tr>';
    } else {
      let used = 0;
      users.forEach(u => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = `${u.first||''} ${u.last||''}`; tr.appendChild(tdName);
        const tdEmail = document.createElement('td'); tdEmail.textContent = u.email || ''; tr.appendChild(tdEmail);
        const tdRole = document.createElement('td'); tdRole.textContent = u.role || 'staff'; tr.appendChild(tdRole);
        const tdAct = document.createElement('td'); tdAct.innerHTML = '<button class="btn" disabled>Remove</button>'; tr.appendChild(tdAct);
        tbody.appendChild(tr);
        if(u.role !== 'admin') used++;
      });
      card.querySelector('#xm-slotsUsed').textContent = String(used);
    }
  }catch(e){ console.warn('populate fallback staff failed', e); }

  // copy join
  try{
    const copyBtn = card.querySelector('#xm-btnCopyJoin');
    const joinInput = card.querySelector('#xm-setJoinCode');
    if(copyBtn && joinInput){
      copyBtn.addEventListener('click', async () => {
        try{
          const text = (joinInput.value||'').toString();
          if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
          else { joinInput.select(); document.execCommand('copy'); }
          copyBtn.textContent = 'Copied!'; setTimeout(()=> copyBtn.textContent = 'Copy', 1200);
        }catch(ex){ console.warn('fallback copy failed', ex); }
      });
    }
  }catch(e){ }

  // regenerate (local only)
  try{
    const regen = card.querySelector('#xm-btnRegenerateJoin');
    const joinInput = card.querySelector('#xm-setJoinCode');
    if(regen && joinInput){
      regen.addEventListener('click', () => {
        if(!confirm('Regenerate join code (local only)?')) return;
        function gen(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
        const shopsLocal = getShops();
        let code = gen(); let tries = 0;
        while((shopsLocal || []).some(s => String(s.join_code||'').toUpperCase() === code) && tries < 50){ code = gen(); tries++; }
        // update local copy
        if(Array.isArray(shopsLocal) && shopsLocal.length){ shopsLocal[0].join_code = code; setShops(shopsLocal); }
        else { setShops([{ id: shop.id, name: shop.name, join_code: code, staff_limit: shop.staff_limit }]); }
        joinInput.value = code;
        regen.textContent = 'Saved'; setTimeout(()=> regen.textContent = 'Regenerate Code', 1200);
      });
    }
  }catch(e){ console.warn('fallback regen failed', e); }
}

})();

