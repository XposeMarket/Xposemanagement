  // Ensure theme panel matches profile card height
  window.addEventListener('DOMContentLoaded', () => {
    const card = document.getElementById('profileCard');
    const panel = document.getElementById('themePanel');
    if (card && panel) {
      panel.style.height = card.offsetHeight + 'px';
    }
  });
  // Theme picker swatch logic
  function setTheme(theme) {
    const html = document.documentElement;
    html.classList.remove('theme-alt', 'theme-blue', 'theme-bluegrey', 'theme-dark');
    if (theme && theme !== 'light') html.classList.add(theme);
    try { localStorage.setItem('xm_theme', theme); } catch (e) {}
    // Optionally update user profile theme in localStorage if logged in
    try {
      const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const idx = users.findIndex(u => u.email === session.email);
      if (idx >= 0) {
        users[idx].theme = theme;
        localStorage.setItem('xm_users', JSON.stringify(users));
      }
    } catch (e) {}
    // Highlight selected swatch
    document.querySelectorAll('.theme-swatch').forEach(el => {
      el.style.outline = (el.dataset.theme === theme) ? '2.5px solid var(--accent)' : 'none';
    });
  }

  // Attach click handlers to swatches
  setTimeout(() => {
    const swatches = document.querySelectorAll('.theme-swatch');
    if (swatches.length) {
      swatches.forEach(el => {
        el.addEventListener('click', () => setTheme(el.dataset.theme));
      });
      // Highlight current theme
      let current = 'light';
      const html = document.documentElement;
      if (html.classList.contains('theme-dark')) current = 'theme-dark';
      else if (html.classList.contains('theme-bluegrey')) current = 'theme-bluegrey';
      else if (html.classList.contains('theme-blue')) current = 'theme-blue';
      else if (html.classList.contains('theme-alt')) current = 'theme-alt';
      document.querySelectorAll('.theme-swatch').forEach(el => {
        el.style.outline = (el.dataset.theme === current) ? '2.5px solid var(--accent)' : 'none';
      });
    }
  }, 0);
/**
 * pages/profile.js
 * Profile page setup - User profile management (separate from shop info)
 * FIXED: Load profile using auth user ID instead of email
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

import { getSupabaseClient } from '../helpers/supabase.js';

function setupProfile() {
  console.log('📄 Setting up Profile page...');
  
  const supabase = getSupabaseClient();
  let currentUser = null;
  let currentShopId = null;
  
  // Get current user and shop
  function getCurrentUserData() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      currentShopId = session.shopId || null;
      
      const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
      return users.find(u => u.email === session.email) || {};
    } catch (e) {
      return {};
    }
  }
  
  // Load user profile data
  async function loadUserProfile() {
    try {
      // Get authenticated user from Supabase
      if (supabase) {
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !authUser) {
          console.error('Could not get authenticated user:', authError);
          return;
        }
        
        console.log('✅ Authenticated user:', authUser.email);
        
        // Load user profile from users table using auth ID
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single();
        
        if (userError) {
          console.error('Error loading user profile:', userError);
          
          // Fallback to auth metadata
          currentUser = {
            email: authUser.email,
            first: authUser.user_metadata?.first || '',
            last: authUser.user_metadata?.last || '',
            role: authUser.user_metadata?.role || 'staff'
          };
          console.log('📋 Using auth metadata:', currentUser);
        } else {
          currentUser = userData;
          console.log('✅ Loaded user profile:', currentUser);
        }
      } else {
        // Fallback to localStorage
        currentUser = getCurrentUserData();
        
        if (!currentUser || !currentUser.email) {
          console.warn('No user found in localStorage');
          return;
        }
      }
      
      // Populate form
      document.getElementById('pfFirst').value = currentUser.first || '';
      document.getElementById('pfLast').value = currentUser.last || '';
      document.getElementById('pfEmail').value = currentUser.email || '';
      document.getElementById('pfRole').value = currentUser.role || 'staff';
      
      console.log('✅ Profile form populated');
    } catch (ex) {
      console.error('Exception loading user profile:', ex);
    }
  }
  
  // Save user profile
  async function saveUserProfile() {
    const first = document.getElementById('pfFirst').value.trim();
    const last = document.getElementById('pfLast').value.trim();
    
    if (!first || !last) {
      showNotification('Please enter first and last name', 'error');
      return;
    }
    
    try {
      if (supabase) {
        // Get authenticated user
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !authUser) {
          throw new Error('Could not get authenticated user');
        }
        
        // Update in Supabase users table using auth ID
        const { error } = await supabase
          .from('users')
          .update({
            first,
            last,
            updated_at: new Date().toISOString()
          })
          .eq('id', authUser.id);
        
        if (error) throw error;
        
        console.log('✅ Profile updated in users table');
        
        // Also update auth metadata
        const { error: authError2 } = await supabase.auth.updateUser({
          data: { first, last }
        });
        
        if (authError2) {
          console.warn('Could not update auth metadata:', authError2);
        } else {
          console.log('✅ Auth metadata updated');
        }
      } else {
        // Update localStorage
        const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
        const userIndex = users.findIndex(u => u.email === currentUser.email);
        if (userIndex !== -1) {
          users[userIndex] = {
            ...users[userIndex],
            first,
            last
          };
          localStorage.setItem('xm_users', JSON.stringify(users));
        }
      }
      
      showNotification('Profile updated successfully!');
      
      // Reload user data
      await loadUserProfile();
    } catch (ex) {
      console.error('Error saving profile:', ex);
      showNotification('Error saving profile: ' + ex.message, 'error');
    }
  }
  
  // Change email modal
  function openChangeEmailModal() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.classList.remove('hidden');
  }
  
  function closeChangeEmailModal() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.classList.add('hidden');
    
    // Clear fields
    document.getElementById('newEmail').value = '';
    document.getElementById('curPassForEmail').value = '';
    document.getElementById('emailNotice').textContent = '';
  }
  
  async function saveNewEmail() {
    const newEmail = document.getElementById('newEmail').value.trim();
    const currentPassword = document.getElementById('curPassForEmail').value.trim();
    const notice = document.getElementById('emailNotice');
    
    if (!newEmail || !currentPassword) {
      notice.textContent = 'Please fill in all fields';
      notice.className = 'notice danger';
      return;
    }
    
    try {
      if (supabase) {
        // Re-authenticate user
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: currentPassword
        });
        
        if (signInError) {
          notice.textContent = 'Current password is incorrect';
          notice.className = 'notice danger';
          return;
        }
        
        // Update email
        const { error: updateError } = await supabase.auth.updateUser({
          email: newEmail
        });
        
        if (updateError) {
          notice.textContent = 'Error updating email: ' + updateError.message;
          notice.className = 'notice danger';
          return;
        }
        
        // Update users table
        await supabase
          .from('users')
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq('email', currentUser.email);
        
        // Update session
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        session.email = newEmail;
        localStorage.setItem('xm_session', JSON.stringify(session));
        
        notice.textContent = 'Email updated! Please check your inbox to verify.';
        notice.className = 'notice success';
        
        setTimeout(() => {
          closeChangeEmailModal();
          window.location.reload();
        }, 2000);
      } else {
        notice.textContent = 'Email change requires Supabase connection';
        notice.className = 'notice danger';
      }
    } catch (ex) {
      console.error('Error changing email:', ex);
      notice.textContent = 'Error: ' + ex.message;
      notice.className = 'notice danger';
    }
  }
  
  // Change password modal
  function openChangePasswordModal() {
    const modal = document.getElementById('passModal');
    if (modal) modal.classList.remove('hidden');
  }
  
  function closeChangePasswordModal() {
    const modal = document.getElementById('passModal');
    if (modal) modal.classList.add('hidden');
    
    // Clear fields
    document.getElementById('curPass').value = '';
    document.getElementById('newPass').value = '';
    document.getElementById('confPass').value = '';
    document.getElementById('passNotice').textContent = '';
  }
  
  async function saveNewPassword() {
    const currentPassword = document.getElementById('curPass').value.trim();
    const newPassword = document.getElementById('newPass').value.trim();
    const confirmPassword = document.getElementById('confPass').value.trim();
    const notice = document.getElementById('passNotice');
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      notice.textContent = 'Please fill in all fields';
      notice.className = 'notice danger';
      return;
    }
    
    if (newPassword.length < 6) {
      notice.textContent = 'Password must be at least 6 characters';
      notice.className = 'notice danger';
      return;
    }
    
    if (newPassword !== confirmPassword) {
      notice.textContent = 'Passwords do not match';
      notice.className = 'notice danger';
      return;
    }
    
    try {
      if (supabase) {
        // Re-authenticate user
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: currentPassword
        });
        
        if (signInError) {
          notice.textContent = 'Current password is incorrect';
          notice.className = 'notice danger';
          return;
        }
        
        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword
        });
        
        if (updateError) {
          notice.textContent = 'Error updating password: ' + updateError.message;
          notice.className = 'notice danger';
          return;
        }
        
        notice.textContent = 'Password updated successfully!';
        notice.className = 'notice success';
        
        setTimeout(() => {
          closeChangePasswordModal();
        }, 2000);
      } else {
        // Update in localStorage
        const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
        const userIndex = users.findIndex(u => u.email === currentUser.email);
        if (userIndex !== -1) {
          // Verify current password
          if (users[userIndex].password !== currentPassword) {
            notice.textContent = 'Current password is incorrect';
            notice.className = 'notice danger';
            return;
          }
          
          users[userIndex].password = newPassword;
          localStorage.setItem('xm_users', JSON.stringify(users));
          
          notice.textContent = 'Password updated successfully!';
          notice.className = 'notice success';
          
          setTimeout(() => {
            closeChangePasswordModal();
          }, 2000);
        }
      }
    } catch (ex) {
      console.error('Error changing password:', ex);
      notice.textContent = 'Error: ' + ex.message;
      notice.className = 'notice danger';
    }
  }
  
  // Show notification
  function showNotification(message, type = 'success') {
    const pfSaved = document.getElementById('pfSaved');
    if (!pfSaved) return;
    
    pfSaved.textContent = message;
    pfSaved.className = 'notice ' + (type === 'error' ? 'danger' : 'success');
    
    setTimeout(() => {
      pfSaved.textContent = '';
      pfSaved.className = 'notice';
    }, 3000);
  }
  
  // Event listeners
  const saveBtn = document.getElementById('pfSave');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveUserProfile);
  }
  
  const changeEmailBtn = document.getElementById('changeEmailBtn');
  if (changeEmailBtn) {
    changeEmailBtn.addEventListener('click', openChangeEmailModal);
  }
  
  const closeEmailBtn = document.getElementById('closeEmail');
  if (closeEmailBtn) {
    closeEmailBtn.addEventListener('click', closeChangeEmailModal);
  }
  
  const saveEmailBtn = document.getElementById('saveEmail');
  if (saveEmailBtn) {
    saveEmailBtn.addEventListener('click', saveNewEmail);
  }
  
  const changePassBtn = document.getElementById('changePassBtn');
  if (changePassBtn) {
    changePassBtn.addEventListener('click', openChangePasswordModal);
  }
  
  const closePassBtn = document.getElementById('closePass');
  if (closePassBtn) {
    closePassBtn.addEventListener('click', closeChangePasswordModal);
  }
  
  const savePassBtn = document.getElementById('savePass');
  if (savePassBtn) {
    savePassBtn.addEventListener('click', saveNewPassword);
  }
  
  // Initial load
  loadUserProfile();
  
  console.log('✅ Profile page setup complete');
}

export { setupProfile };
