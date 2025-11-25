// pages/signup.js
// Clean signup logic with join code requirement (Supabase + localStorage fallback)
// FIXED: Added OAuth callback handling

import { getSupabaseClient } from '../helpers/supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('signupForm');
  const err = document.getElementById('signupErr');
  
  if (!form) return;

  const supabase = getSupabaseClient();

  // ============================================================================
  // OAUTH CALLBACK HANDLER - Check if we're returning from Google OAuth
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('oauth') === 'google' && supabase) {
    console.log('🔄 Processing OAuth callback...');
    
    try {
      // Get the session from the URL hash (Supabase puts it there)
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) throw sessionError;
      
      if (session && session.user) {
        console.log('✅ OAuth session found:', session.user.email);
        
        // Retrieve stored join code and shop ID from sessionStorage (fallback to URL params)
        let joinCode = sessionStorage.getItem('signup_join_code');
        let shopId = sessionStorage.getItem('signup_shop_id');
        // Fallback: check URL query params (multi-tenant helper may append shop_id)
        if ((!joinCode || !shopId) && urlParams.get('shop_id')) {
          shopId = urlParams.get('shop_id');
        }
        if ((!joinCode || !shopId) && urlParams.get('join_code')) {
          joinCode = urlParams.get('join_code');
        }
        if (!shopId) {
          err.textContent = 'OAuth error: Missing shop ID. Please try again.';
          err.style.color = 'red';
          return;
        }
        
        console.log('📋 Retrieved join code:', joinCode, 'Shop ID:', shopId);
        
        // Only create staff in shop_staff table
        const userId = session.user.id;
        const email = session.user.email;
        const first = session.user.user_metadata?.given_name || session.user.user_metadata?.first || '';
        const last = session.user.user_metadata?.family_name || session.user.user_metadata?.last || '';
        
        // Insert into shop_staff table (now includes auth_id)
        try {
          const { error: staffErr } = await supabase
            .from('shop_staff')
            .insert([{
              shop_id: shopId,
              first_name: first,
              last_name: last,
              email: email,
              role: 'staff',
              auth_id: userId
            }]);
          if (staffErr) {
            console.warn('⚠️ shop_staff insert warning:', staffErr);
          } else {
            console.log('✅ shop_staff record created');
          }
        } catch (e) {
          console.warn('Exception inserting into shop_staff:', e);
        }
        
        // Do not auto-sign-in; save as pending and sign out to avoid temporary elevated access
        localStorage.setItem('xm_pending_user', JSON.stringify({
          shopId: shopId,
          email,
          role: 'staff'
        }));

        // Clean up sessionStorage
        sessionStorage.removeItem('signup_join_code');
        sessionStorage.removeItem('signup_shop_id');

        // Show success message
        showTopBanner(`🎉 Account created with Google. Please sign in to continue.`, 'success');

        // Sign out the OAuth session and redirect to login
        try { await supabase.auth.signOut(); } catch(e) { console.warn('Sign out failed', e); }
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 1500);
        
        return;
      }
    } catch (ex) {
  err.textContent = 'There was a problem signing up with Google. Please try again or use another method.';
  err.style.color = 'red';
    }
  }

  // ============================================================================
  // REGULAR SIGNUP FORM HANDLER
  // ============================================================================
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    err.textContent = '';
    err.style.color = '';

    // Collect form data
    const joinCode = document.getElementById('suJoin').value.trim().toUpperCase();
    const first = document.getElementById('suFirst').value.trim();
    const last = document.getElementById('suLast').value.trim();
    const email = document.getElementById('suEmail').value.trim();
    const pass = document.getElementById('suPass').value.trim();

    // Require join code explicitly
    if (!joinCode) {
      err.textContent = 'Please enter a shop join code.';
      err.style.color = 'red';
      return;
    }

    // Try Supabase first
    let supabaseSuccess = false;

    try {
      if (supabase) {
        console.log('🔧 Starting signup with join code...');
        
        // Step 1: Validate join code and get shop
        const { data: shopsData, error: shopErr } = await supabase
          .from('shops')
          .select('*')
          .ilike('join_code', joinCode)
          .single();
        
        console.log('🏪 Shop lookup result:', shopsData, shopErr);
        
        if (shopErr || !shopsData) {
          throw new Error('Invalid join code. Please check with your shop admin.');
        }
        
        const shop = shopsData;
        console.log('✅ Shop found:', shop.name);
        
        // Step 2: Check staff limit
        // Count staff in shop_staff table (not users)
        const { data: staffRows, error: staffErr } = await supabase
          .from('shop_staff')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', shop.id);

        if (staffErr) {
          throw new Error('Could not check staff limit. Please try again later.');
        }
        const currentStaff = Array.isArray(staffRows) ? staffRows.length : 0;
        if (currentStaff >= (shop.staff_limit || 3)) {
          throw new Error('This shop has reached its staff limit. Contact your admin.');
        }
        
        // Step 3: Create user in Auth
        const { data: signData, error: signErr } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { 
              data: { 
                first, 
                last,
                role: 'staff',
                shop_id: shop.id
              },
              emailRedirectTo: window.location.origin + '/login.html'
            }
        });
        
        console.log('🔐 Auth signUp result:', signData, signErr);
        
        if (signErr) {
          console.error('❌ Auth signup error:', signErr);
          
          // Handle specific errors
          if (signErr.message && signErr.message.includes('already registered')) {
            throw new Error('This email is already registered. Please log in instead.');
          }
          
          throw signErr;
        }
        
        if (!signData || !signData.user) {
          throw new Error('User creation failed - no user returned.');
        }
        
        console.log('✅ User created in Auth:', signData.user.id);
        const userId = signData.user.id;
        
        // Step 4: Create user record in public.users table
        // Only insert staff into shop_staff table
        try {
          const { data: staffInsert, error: staffErr } = await supabase
            .from('shop_staff')
            .insert([{
              shop_id: shop.id,
              first_name: first,
              last_name: last,
              email: email,
              role: 'staff',
              auth_id: userId
            }]);
          if (staffErr) {
            // Log but don't block signup success — admin can fix later
            console.warn('Could not insert into shop_staff:', staffErr);
          } else {
            console.log('✅ shop_staff insert success:', staffInsert);
          }
        } catch (e) {
          console.warn('Exception inserting into shop_staff:', e);
        }
        
        // Check if session exists (auto-confirmed signup)
        const hasSession = signData.session !== null;
        
        if (hasSession) {
          // User is already signed in
          console.log('✅ Session auto-created:', signData.session);
          
          // Save session info locally
          localStorage.setItem('xm_session', JSON.stringify({ 
            email, 
            userId,
            shopId: shop.id,
            role: 'staff',
            at: Date.now() 
          }));

          supabaseSuccess = true;
          console.log('🎉 Signup complete! Redirecting to login...');
          showTopBanner(`🎉 Welcome to ${shop.name}, ${first}! Please sign in.`, 'success');
          
          // Sign out to avoid temporary elevated access, then redirect to login
          try { await supabase.auth.signOut(); } catch(e) { console.warn('Sign out failed', e); }
          setTimeout(() => {
            window.location.href = 'login.html';
          }, 1500);
          
        } else {
          // Email confirmation required
          console.log('📧 Email confirmation required');
          
          // Save pending info
          localStorage.setItem('xm_pending_user', JSON.stringify({
            shopId: shop.id,
            shopName: shop.name,
            email,
            role: 'staff'
          }));
          
          supabaseSuccess = true;
          console.log('📧 Signup created; email confirmation required.');
          showTopBanner(`✅ Account created! Check ${email} to confirm.`, 'success');
        }
        
        return;
      }
    } catch (ex) {
  err.textContent = 'There was a problem creating your account. Please try again.';
  err.style.color = 'red';
      // Don't redirect on error
      return;
    }

    // LocalStorage fallback
    if (!supabaseSuccess) {
      try {
        console.log('📦 Falling back to localStorage...');
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
        
        // Find shop by join code
        const shop = shops.find(s => String(s.join_code || '').toUpperCase() === joinCode);
        
        if (!shop) {
          err.textContent = 'Invalid join code. Please check with your shop admin.';
          return;
        }
        
        // Check if email already in use
        if (users.some(u => u.email === email)) {
          err.textContent = 'Email already in use. Please log in instead.';
          return;
        }
        
        // Check staff limit
        const currentStaff = users.filter(u => u.shop_id === shop.id && u.role !== 'admin').length;
        if (currentStaff >= (shop.staff_limit || 3)) {
          err.textContent = 'This shop has reached its staff limit. Contact your admin.';
          return;
        }
        
        const userId = 'u_' + Math.random().toString(36).slice(2,8);
        const user = { 
          id: userId, 
          first, 
          last, 
          email, 
          password: pass,
          role: 'staff',
          shop_id: shop.id
        };
        users.push(user);
        localStorage.setItem('xm_users', JSON.stringify(users));
        
        // Also add to local xm_shop_staff for local-testing parity
        try {
          const staffLocal = JSON.parse(localStorage.getItem('xm_shop_staff') || '[]');
          staffLocal.push({
            id: 's_' + Math.random().toString(36).slice(2,8),
            shop_id: shop.id,
            first_name: first,
            last_name: last,
            email: email,
            role: 'staff',
            created_at: new Date().toISOString()
          });
          localStorage.setItem('xm_shop_staff', JSON.stringify(staffLocal));
          console.log('✅ Local shop_staff record created');
        } catch (e) { 
          console.warn('Could not create local shop_staff record', e); 
        }
        
        // Do not auto-sign-in local fallback; treat as pending and redirect to login
        localStorage.setItem('xm_pending_user', JSON.stringify({
          shopId: shop.id,
          shopName: shop.name,
          email,
          role: 'staff'
        }));
        showTopBanner(`🎉 Account created for ${shop.name}. Please sign in.`, 'success');
        console.log('✅ Local user created (pending). Redirecting to login...');
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 1500);
      } catch (ex) {
  err.textContent = 'There was a problem saving your account. Please try again.';
  err.style.color = 'red';
      }
    }
  });

  // ============================================================================
  // GOOGLE OAUTH BUTTON HANDLER
  // ============================================================================
  const googleBtn = document.getElementById('googleSignupBtn');
  if (googleBtn) {
    if (!supabase) {
      console.warn('⚠️ Supabase not available for Google OAuth');
      googleBtn.disabled = true;
      googleBtn.title = 'Google signup not available (Supabase not initialized)';
    } else {
      googleBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const joinCode = document.getElementById('suJoin')?.value?.trim()?.toUpperCase();
        
        if (!joinCode) {
          err.textContent = 'Please enter a shop join code first.';
          err.style.color = 'red';
          return;
        }
        
        try {
          // Validate join code first
          console.log('🔍 Validating join code...');
          const { data: shopData, error: shopErr } = await supabase
            .from('shops')
            .select('id')
            .ilike('join_code', joinCode)
            .single();
          
          if (shopErr) {
            console.error('❌ Join code validation error:', shopErr);
            err.textContent = 'Invalid join code. Please check with your shop admin.';
            err.style.color = 'red';
            return;
          }
          
          if (!shopData) {
            err.textContent = 'Invalid join code. Please check with your shop admin.';
            err.style.color = 'red';
            return;
          }
          
          // Store join code for after OAuth redirect
          sessionStorage.setItem('signup_join_code', joinCode);
          sessionStorage.setItem('signup_shop_id', shopData.id);
          
          console.log('🔐 Initiating Google OAuth signup...');
          
          const { error: oauthError } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { 
              redirectTo: window.location.origin + '/signup.html?oauth=google'
            }
          });
          
          if (oauthError) {
            console.error('❌ OAuth error:', oauthError);
            err.textContent = `OAuth error: ${oauthError.message || 'Could not start Google signup'}`;
            err.style.color = 'red';
          }
        } catch (error) {
          console.error('❌ Exception during OAuth:', error);
          err.textContent = 'Could not start Google signup. Please try again.';
          err.style.color = 'red';
        }
      });
    }
  } else {
    console.warn('⚠️ Google signup button not found');
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function showTopBanner(message, type = 'success') {
  // remove existing
  let existing = document.getElementById('topBanner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'topBanner';
  banner.textContent = message;
  banner.style.position = 'fixed';
  banner.style.left = '50%';
  banner.style.transform = 'translate(-50%, -110%)';
  banner.style.top = '0';
  banner.style.zIndex = '9999';
  banner.style.padding = '12px 18px';
  banner.style.borderRadius = '0 0 6px 6px';
  banner.style.boxShadow = '0 4px 14px rgba(0,0,0,0.12)';
  banner.style.transition = 'transform 320ms ease';
  banner.style.fontWeight = '600';
  banner.style.background = type === 'error' ? '#ff6b6b' : '#2ecc71';
  banner.style.color = 'white';
  banner.style.maxWidth = '900px';
  banner.style.width = 'calc(100% - 40px)';
  banner.style.textAlign = 'center';
  
  document.body.appendChild(banner);
  
  // animate down
  requestAnimationFrame(() => { 
    banner.style.transform = 'translate(-50%, 10px)'; 
  });
  
  // hide after 2.5s
  setTimeout(() => {
    banner.style.transform = 'translate(-50%, -110%)';
    setTimeout(() => { 
      try { banner.remove(); } catch(e){} 
    }, 360);
  }, 2500);
}
