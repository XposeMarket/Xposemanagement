/**
 * pages/messages-backend.js
 * Backend-integrated Messages page (Twilio + Supabase)
 * 
 * Imported by: app.js (replaces pages/messages.js)
 * Imports from: helpers/
 */

import { supabase } from '../helpers/supabase.js';

function setupMessages() {
    // Wire up Customer Info Modal Save button
    const newCustSave = document.getElementById('newCustSave');
    if (newCustSave) {
      newCustSave.addEventListener('click', async () => {
        if (!activeThread) {
          alert('No thread selected.');
          return;
        }
        const newCustFirst = document.getElementById('newCustFirst');
        const newCustLast = document.getElementById('newCustLast');
        const newCustPhone = document.getElementById('newCustPhone');
        const newCustEmail = document.getElementById('newCustEmail');
        const newCustNotes = document.getElementById('newCustNotes');
        const emailVal = (newCustEmail?.value || '').trim();
        const rawPhone = (newCustPhone?.value || '').trim();
        const phoneVal = rawPhone === '' ? null : normalizePhone(rawPhone);
        const updates = {
          customer_first: newCustFirst?.value?.trim() || '',
          customer_last: newCustLast?.value?.trim() || '',
          phone: phoneVal,
          email: emailVal === '' ? null : emailVal,
          notes: newCustNotes?.value?.trim() || '',
          updated_at: new Date().toISOString()
        };
        try {
          let customerId = activeThread.customer_id;
          const shopId = await getCurrentShopId();
          if (!shopId) throw new Error('No shop ID found');

          // If no linked customer, try to find an existing customer by phone or email
          if (!customerId) {
            let existing = null;
            try {
              if (updates.phone && updates.email) {
                const orFilter = `phone.eq.${updates.phone},email.eq.${updates.email}`;
                const { data: found } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .or(orFilter)
                  .limit(1);
                if (found && found.length) existing = found[0];
              } else if (updates.phone) {
                const { data: found } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .eq('phone', updates.phone)
                  .limit(1);
                if (found && found.length) existing = found[0];
              } else if (updates.email) {
                const { data: found } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .eq('email', updates.email)
                  .limit(1);
                if (found && found.length) existing = found[0];
              }
            } catch (e) {
              console.warn('Could not query existing customer:', e.message || e);
            }

            if (existing) {
              // Merge updates into existing customer and link thread
              const merged = Object.assign({}, existing, updates, { updated_at: new Date().toISOString() });
              const { error: updErr } = await supabase
                .from('customers')
                .update({
                  customer_first: merged.customer_first,
                  customer_last: merged.customer_last,
                  phone: merged.phone,
                  email: merged.email,
                  notes: merged.notes,
                  updated_at: merged.updated_at
                })
                .eq('id', existing.id);
              if (updErr) throw updErr;
              customerId = existing.id;

              const { error: threadUpdateError } = await supabase
                .from('threads')
                .update({ 
                  customer_id: customerId,
                  customer_first: merged.customer_first,
                  customer_last: merged.customer_last
                })
                .eq('id', activeThread.id);
              if (threadUpdateError) throw threadUpdateError;
            } else {
              // Insert new customer - if duplicate exists, just find and use it
              const insertData = Object.assign({}, updates, {
                shop_id: shopId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
              
              const { data: newCustomer, error: insertError } = await supabase
                .from('customers')
                .insert([insertData])
                .select()
                .single();
                
              if (insertError && insertError.code === '23505') {
                // Duplicate exists - find existing customer by phone
                const { data: existingCust } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .eq('phone', updates.phone)
                  .single();
                
                if (existingCust) {
                  customerId = existingCust.id;
                  // Update existing customer with new info
                  await supabase
                    .from('customers')
                    .update(updates)
                    .eq('id', customerId);
                } else {
                  // Shouldn't happen but throw if it does
                  throw new Error('Duplicate error but customer not found');
                }
              } else if (insertError) {
                throw insertError;
              } else {
                customerId = newCustomer.id;
              }
              // Link thread to customer and cache name
              const { error: threadUpdateError } = await supabase
                .from('threads')
                .update({ 
                  customer_id: customerId,
                  customer_first: newCustomer.customer_first,
                  customer_last: newCustomer.customer_last
                })
                .eq('id', activeThread.id);
              if (threadUpdateError) throw threadUpdateError;
            }
          } else {
            // Updating an existing linked customer: detect if another customer with same phone/email exists
            let duplicate = null;
            try {
              if (updates.phone) {
                const { data: found } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .eq('phone', updates.phone)
                  .limit(1);
                if (found && found.length && found[0].id !== customerId) duplicate = found[0];
              }
              if (!duplicate && updates.email) {
                const { data: found } = await supabase
                  .from('customers')
                  .select('*')
                  .eq('shop_id', shopId)
                  .eq('email', updates.email)
                  .limit(1);
                if (found && found.length && found[0].id !== customerId) duplicate = found[0];
              }
            } catch (e) {
              console.warn('Duplicate check failed:', e.message || e);
            }

            if (duplicate) {
              // Merge into duplicate and point thread at that customer
              const merged = Object.assign({}, duplicate, updates, { updated_at: new Date().toISOString() });
              const { error: dupUpdErr } = await supabase
                .from('customers')
                .update({
                  customer_first: merged.customer_first,
                  customer_last: merged.customer_last,
                  phone: merged.phone,
                  email: merged.email,
                  notes: merged.notes,
                  updated_at: merged.updated_at
                })
                .eq('id', duplicate.id);
              if (dupUpdErr) throw dupUpdErr;

              // Re-link thread to the duplicate customer
              const { error: threadUpdateError } = await supabase
                .from('threads')
                .update({ 
                  customer_id: duplicate.id,
                  customer_first: merged.customer_first,
                  customer_last: merged.customer_last
                })
                .eq('id', activeThread.id);
              if (threadUpdateError) throw threadUpdateError;
              customerId = duplicate.id;
            } else {
              // Safe to update the existing customer
              const { error } = await supabase
                .from('customers')
                .update(updates)
                .eq('id', customerId);
              if (error) throw error;
              // Also update cached name in thread
              const { error: threadUpdateError } = await supabase
                .from('threads')
                .update({
                  customer_first: updates.customer_first,
                  customer_last: updates.customer_last
                })
                .eq('id', activeThread.id);
              if (threadUpdateError) throw threadUpdateError;
            }
          }
          if (custModal) custModal.classList.add('hidden');
          await loadThreads();
        } catch (ex) {
          alert('Error saving customer: ' + (ex.message || ex));
        }
      });
    }
  console.log('📄 setupMessages (backend) initializing');

  const threadListEl = document.getElementById('threadList');
  const chatBox = document.getElementById('chatBox');
  const threadTitle = document.getElementById('threadTitle');
  const threadSubtitle = document.getElementById('threadSubtitle');
  const threadAvatar = document.getElementById('threadAvatar');
  const threadCenteredTitle = document.getElementById('threadCenteredTitle');
  let msgInput = document.getElementById('msgInput');
  let sendForm = document.getElementById('sendForm');
  const threadBackBtn = document.getElementById('threadBackBtn');
  const chatPanel = document.querySelector('.chat-panel');
  const threadsPanel = document.querySelector('.threads-panel');
  const threadPanelHeader = document.getElementById('threadPanelHeader');
  const messagesWrap = document.querySelector('.messages-wrap');
  
  let editMode = false;
  let threads = [];
  let activeThreadId = null;
  let activeThread = null;
  let messages = [];
  let shopTwilioNumber = null;
  let _lastLoadedShopId = null;
  const API_BASE_URL = 'https://xpose-stripe-server.vercel.app';
  
  // Helper function to re-query buttons after header updates
  function getHeaderButtons() {
    return {
      newThreadBtn: document.getElementById('newThreadBtn'),
      editThreadsBtn: document.getElementById('editThreadsBtn'),
      threadSearch: document.getElementById('threadSearch')
    };
  }

  // Helper function to attach event listeners to header buttons
  function attachHeaderEventListeners() {
    const { newThreadBtn, editThreadsBtn, threadSearch } = getHeaderButtons();

    // Search filter
    if (threadSearch) {
      threadSearch.addEventListener('input', (ev) => {
        threadFilter = (ev.target.value || '').toLowerCase();
        renderThreadList();
      });
    }

    // New thread button - open modal
    if (newThreadBtn) {
      newThreadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const newThreadModal = document.getElementById('newThreadModal');
        if (newThreadModal) newThreadModal.classList.remove('hidden');
        const input = document.getElementById('newThreadPhone');
        if (input) input.focus();
      });
    }

    // Edit mode toggle
    if (editThreadsBtn) {
      editThreadsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        editMode = !editMode;
        editThreadsBtn.textContent = editMode ? 'Done' : 'Edit';
        renderThreadList();
      });
    }
  }

  let threadFilter = '';

  // Helper: format time display
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffMins < 1440) return `${Math.floor(diffMins/60)}h`;
    if (diffMins < 10080) return `${Math.floor(diffMins/1440)}d`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Helper: escape HTML
  function escapeHtml(s) { 
    return (s||'').toString()
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;'); 
  }

  // Helper: scroll to bottom
  function scrollChatToBottom() {
    setTimeout(() => {
      if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
    }, 0);
  }

  // Helper: normalize phone number to E.164 format
  function normalizePhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    
    // Handle 11 digits starting with 1 (US)
    if (digits.length === 11 && digits[0] === '1') {
      return '+' + digits;
    }
    
    // Handle 10 digits (US/Canada)
    if (digits.length === 10) {
      return '+1' + digits;
    }
    
    // Handle 7 digits (assume US area code)
    if (digits.length === 7) {
      return '+1555' + digits; // Placeholder area code
    }
    
    // Handle other lengths - just add +
    if (digits.length > 0) {
      return '+' + digits;
    }
    
    return phone; // Return as-is if can't parse
  }

  // Helper: format time display
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffMins < 1440) return `${Math.floor(diffMins/60)}h`;
    if (diffMins < 10080) return `${Math.floor(diffMins/1440)}d`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Helper: escape HTML
  function escapeHtml(s) { 
    return (s||'').toString()
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;'); 
  }

  // Get current shop ID directly from Supabase
  async function getCurrentShopId() {
    try {
      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('No authenticated user:', authError);
        return null;
      }

      // Read the user's `shop_id` from the `users` table which is updated by `switchShop()`.
      const { data: userRow, error: userRowErr } = await supabase
        .from('users')
        .select('shop_id')
        .eq('id', user.id)
        .single();

      if (userRowErr) {
        console.error('Error fetching current shop from users table:', userRowErr);
        return null;
      }

      return userRow?.shop_id || null;
    } catch (error) {
      console.error('Error in getCurrentShopId:', error);
      return null;
    }
  }

  // Load threads from Supabase
  async function loadThreads() {
    try {
      const shopId = await getCurrentShopId();
      if (!shopId) {
        console.error('No shop ID found');
        return;
      }

      // remember which shop we loaded for; used to detect changes
      _lastLoadedShopId = shopId;

      const { data, error } = await supabase
        .from('threads')
        .select(`
          *,
          customer:customers(*),
          twilio_number:shop_twilio_numbers(*)
        `)
        .eq('shop_id', shopId)
        .eq('archived', false)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      threads = data || [];
      console.log('✅ Loaded threads:', threads.length);
      renderThreadList();
    } catch (error) {
      console.error('Error loading threads:', error);
    }
  }

  // Load messages for a thread
  async function loadMessages(threadId) {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      messages = data || [];
      console.log('✅ Loaded messages:', messages.length);
      renderMessages();
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  // Render thread list
  function renderThreadList() {
    threadListEl.innerHTML = '';
    const list = threads.filter(t => {
      if (!threadFilter) return true;
      // Prefer cached name, then joined customer, then recipient
      const customerName = `${t.customer_first || ''} ${t.customer_last || ''}`.trim() ||
        (t.customer ? `${t.customer.first_name || ''} ${t.customer.last_name || ''}`.trim() : '') ||
        t.external_recipient || '';
      const hay = `${customerName}${t.external_recipient||''}${t.last_message||''}`.toLowerCase();
      return hay.indexOf(threadFilter) !== -1;
    });

    list.forEach(t => {
      const item = document.createElement('div');
      item.className = 'thread-item';
      item.style.cssText = 'display:flex;gap:12px;padding:10px;border-radius:8px;align-items:center;cursor:pointer';
      if (t.id === activeThreadId) {
        item.style.background = 'linear-gradient(90deg, rgba(59,130,246,0.08), rgba(59,130,246,0.03))';
      }

      // Avatar
      const av = document.createElement('div');
      av.style.cssText = 'width:44px;height:44px;border-radius:8px;background:#e6eefc;flex:0 0 44px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e40af';
      const displayName = `${t.customer_first || ''} ${t.customer_last || ''}`.trim() ||
        (t.customer ? `${t.customer.first_name || ''} ${t.customer.last_name || ''}`.trim() : '') ||
        t.external_recipient;
      av.textContent = (displayName || 'U').slice(0,1).toUpperCase();

      // Meta (name + last message)
      const meta = document.createElement('div');
      meta.style.cssText = 'flex:1;min-width:0;';
      const name = document.createElement('div');
      name.style.cssText='font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      name.textContent = displayName || 'Unknown';
      const last = document.createElement('div');
      last.style.cssText='font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      last.textContent = t.last_message || '';
      meta.appendChild(name);
      meta.appendChild(last);

      // Controls (time + unread badge + delete btn)
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;gap:8px;align-items:center;flex:0 0 auto';
      
      const time = document.createElement('div');
      time.style.cssText='font-size:11px;color:var(--muted);flex:0 0 auto';
      time.textContent = formatTime(t.last_message_at);
      controls.appendChild(time);

      // Unread badge
      if (t.unread_count && t.unread_count > 0) {
        const badge = document.createElement('div');
        badge.style.cssText = 'background:#3b82f6;color:white;border-radius:10px;padding:2px 6px;font-size:11px;font-weight:600;min-width:18px;text-align:center';
        badge.textContent = t.unread_count > 99 ? '99+' : t.unread_count;
        controls.appendChild(badge);
      }

      if (editMode) {
        const del = document.createElement('button');
        del.className = 'btn small danger';
        del.textContent = 'Delete';
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showRemoveThreadModal(t.id);
        });
        controls.appendChild(del);
      }

      item.appendChild(av);
      item.appendChild(meta);
      item.appendChild(controls);
      item.addEventListener('click', () => { if (!editMode) openThread(t.id); });
      threadListEl.appendChild(item);
    });
  }

  // If user switches shop elsewhere in the app (server-side change), ensure threads are reloaded.
  window.addEventListener('focus', async () => {
    try {
      const supa = supabase;
      const { data: { user } } = await supa.auth.getUser();
      if (!user) return;
      const { data: userRow } = await supa.from('users').select('shop_id').eq('id', user.id).single();
      const current = userRow?.shop_id || null;
      if (current && current !== _lastLoadedShopId) {
        await loadThreads();
        await loadShopTwilioNumber();
      }
    } catch (e) { console.warn('Error checking shop change on focus', e); }
  });

  // Open a thread
  async function openThread(id) {
    const thread = threads.find(x => x.id === id);
    if (!thread) return;

    activeThreadId = id;
    activeThread = thread;

    // Mark thread as read if there are unread messages
    if (thread.unread_count && thread.unread_count > 0) {
      try {
        const { error } = await supabase
          .from('threads')
          .update({ unread_count: 0 })
          .eq('id', thread.id);
        if (!error) {
          thread.unread_count = 0;
        }
      } catch (err) {
        console.error('Failed to mark thread as read:', err);
      }
    }


    // Prefer cached name, then joined customer, then recipient
    const displayName = `${thread.customer_first || ''} ${thread.customer_last || ''}`.trim() ||
      (thread.customer ? `${thread.customer.first_name || ''} ${thread.customer.last_name || ''}`.trim() : '') ||
      thread.external_recipient;

    threadTitle.textContent = displayName || 'Unknown';
    threadSubtitle.textContent = thread.external_recipient || '';
    // Match thread panel avatar style
    if (threadAvatar) {
      threadAvatar.textContent = (displayName || 'U').slice(0,1).toUpperCase();
      threadAvatar.style.width = '44px';
      threadAvatar.style.height = '44px';
      threadAvatar.style.borderRadius = '8px';
      threadAvatar.style.background = '#e6eefc';
      threadAvatar.style.display = 'flex';
      threadAvatar.style.alignItems = 'center';
      threadAvatar.style.justifyContent = 'center';
      threadAvatar.style.fontWeight = '700';
      threadAvatar.style.color = '#1e40af';
      threadAvatar.style.fontSize = '1.5rem';
    }

    // Load messages
    await loadMessages(id);
    renderThreadList();

    // Mobile behavior: slide chat into view
    if (window.innerWidth < 900) {
      if (chatPanel) chatPanel.classList.add('mobile-open');
      if (threadsPanel) threadsPanel.classList.add('mobile-hidden');
      if (threadBackBtn) threadBackBtn.classList.remove('hidden');
      if (threadCenteredTitle) {
        threadCenteredTitle.classList.remove('hidden');
        threadCenteredTitle.textContent = displayName || 'Chat';
      }
    }
  }

  // Render messages
  function renderMessages() {
    chatBox.innerHTML = '';
    messages.forEach(m => {
      appendMessageBubble(m);
    });
    scrollChatToBottom();
  }

  // Append a single message bubble
  function appendMessageBubble(m) {
    const div = document.createElement('div');
    div.className = 'msg-row';
    div.style.display = 'flex';
    
    const isOutbound = m.direction === 'outbound';
    div.style.justifyContent = isOutbound ? 'flex-end' : 'flex-start';

    const bubble = document.createElement('div');
    bubble.className = isOutbound ? 'bubble outgoing' : 'bubble incoming';
    bubble.innerHTML = `${escapeHtml(m.body)}<div class="bubble-time">${formatTime(m.created_at)}</div>`;

    // Handle media attachments
    if (m.media && Array.isArray(m.media)) {
      m.media.forEach(mediaItem => {
        const mediaEl = document.createElement('div');
        mediaEl.style.marginTop = '8px';
        if (mediaItem.contentType && mediaItem.contentType.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = mediaItem.url;
          img.style.maxWidth = '200px';
          img.style.borderRadius = '8px';
          mediaEl.appendChild(img);
        } else {
          const link = document.createElement('a');
          link.href = mediaItem.url;
          link.target = '_blank';
          link.textContent = 'View attachment';
          mediaEl.appendChild(link);
        }
        bubble.appendChild(mediaEl);
      });
    }

    div.appendChild(bubble);
    chatBox.appendChild(div);
  }

  // Load shop's Twilio number
  async function loadShopTwilioNumber() {
    try {
      const shopId = await getCurrentShopId();
      if (!shopId) return;

      const { data, error } = await supabase
        .from('shop_twilio_numbers')
        .select('*')
        .eq('shop_id', shopId)
        .not('twilio_sid', 'is', null)
        .limit(1);

      if (error) throw error;

      shopTwilioNumber = data && data.length > 0 ? data[0] : null;
      console.log('📱 Shop Twilio number:', shopTwilioNumber);
      updatePhoneNumberDisplay();
      
      // Check for pending requests if no number exists
      if (!shopTwilioNumber) {
        await checkPhoneNumberStatus();
      } else {
        updateMessagingUI();
      }
    } catch (error) {
      console.error('Error loading shop Twilio number:', error);
    }
  }

  // Update phone number display in header
  function updatePhoneNumberDisplay() {
    if (threadPanelHeader) {
      let headerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%">';
      headerHTML += '<strong>Messages</strong>';
      headerHTML += '<div style="display:flex;gap:8px;align-items:center">';
      headerHTML += '<button id="newThreadBtn" class="btn small">New</button>';
      headerHTML += '<button id="editThreadsBtn" class="btn small">Edit</button>';
      headerHTML += '</div>';
      headerHTML += '</div>';
      
      if (shopTwilioNumber) {
        headerHTML += `<div style="margin-top:8px;font-size:12px;background:#e0f2fe;color:#0369a1;padding:6px 10px;border-radius:6px;font-family:monospace;text-align:center;">📱 ${shopTwilioNumber.phone_number}</div>`;
      }
      
      headerHTML += '<input id="threadSearch" placeholder="Search customers or threads" style="margin-top:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);width:100%" />';
      
      threadPanelHeader.innerHTML = headerHTML;

      // Re-attach event listeners after DOM update
      attachHeaderEventListeners();
    }
  }

  // Update messaging UI (show request panel or chat)
  function updateMessagingUI() {
    if (!shopTwilioNumber) {
      showRequestNumberPanel();
      if (newThreadBtn) newThreadBtn.style.display = 'none';
      if (editThreadsBtn) editThreadsBtn.style.display = 'none';
    } else {
      hideRequestNumberPanel();
      if (newThreadBtn) newThreadBtn.style.display = 'block';
      if (editThreadsBtn) editThreadsBtn.style.display = 'block';
    }
  }

  // Show "Request Number" panel
  function showRequestNumberPanel() {
    const existing = document.getElementById('requestNumberPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'requestNumberPanel';
    panel.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 60px 20px;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border-radius: 12px;
      text-align: center;
      z-index: 10;
    `;
    panel.innerHTML = `
      <div style="font-size: 48px;">📞</div>
      <h2 style="margin: 0; color: #0c4a6e; font-size: 20px;">Get Your Shop's Phone Number</h2>
      <p style="margin: 0; color: #475569; max-width: 300px; font-size: 14px;">
        Request a dedicated phone number to start messaging your customers about appointments, invoices, and updates.
      </p>
      <button id="requestNumberBtn" class="btn primary" style="margin-top: 10px;">
        Request Number
      </button>
      <p style="margin: 0; font-size: 12px; color: #94a3b8;">No charge - available now</p>
    `;

    const messagesWrap = document.querySelector('.messages-wrap');
    if (messagesWrap) {
      messagesWrap.style.position = 'relative';
      messagesWrap.appendChild(panel);
    } else {
      chatPanel.innerHTML = '';
      chatPanel.style.position = 'relative';
      chatPanel.appendChild(panel);
    }

    const requestBtn = document.getElementById('requestNumberBtn');
    if (requestBtn) {
      requestBtn.addEventListener('click', requestPhoneNumber);
    }
  }

  // Hide request panel
  function hideRequestNumberPanel() {
    const existing = document.getElementById('requestNumberPanel');
    if (existing) existing.remove();
  }

  // Request phone number (waitlist version)
  async function requestPhoneNumber() {
    try {
      const shopId = await getCurrentShopId();
      if (!shopId) {
        alert('Shop not found');
        return;
      }

      const requestBtn = document.getElementById('requestNumberBtn');
      if (requestBtn) {
        requestBtn.disabled = true;
        requestBtn.textContent = 'Submitting...';
      }

      // Get shop details for area code
      const { data: shop } = await supabase
        .from('shops')
        .select('name, phone')
        .eq('id', shopId)
        .single();
      
      const areaCode = shop?.phone?.replace(/\D/g, '').substring(0, 3) || null;

      // Create request in database
      const { data, error } = await supabase
        .from('phone_number_requests')
        .insert({
          shop_id: shopId,
          status: 'pending',
          requested_area_code: areaCode,
          notes: `Request from ${shop?.name || 'shop'}`
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error('You already have a pending request.');
        }
        throw error;
      }

      console.log('✅ Phone number request submitted:', data);
      
      // Update UI to show pending status
      await checkPhoneNumberStatus();

    } catch (error) {
      console.error('Error requesting phone number:', error);
      alert(`Error: ${error.message}`);
      
      const requestBtn = document.getElementById('requestNumberBtn');
      if (requestBtn) {
        requestBtn.disabled = false;
        requestBtn.textContent = 'Request Number';
      }
    }
  }

  // Check phone number status (has number, pending request, or neither)
  async function checkPhoneNumberStatus() {
    try {
      const shopId = await getCurrentShopId();
      if (!shopId) return;

      // Check for pending request
      const { data: requestData } = await supabase
        .from('phone_number_requests')
        .select('*')
        .eq('shop_id', shopId)
        .eq('status', 'pending')
        .single();

      if (requestData) {
        showPendingRequestPanel(requestData);
        return;
      }

      // If no pending request and no number, show request panel
      if (!shopTwilioNumber) {
        showRequestNumberPanel();
      }
    } catch (error) {
      console.error('Error checking phone status:', error);
    }
  }

  // Show pending request status
  function showPendingRequestPanel(request) {
    const existing = document.getElementById('requestNumberPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'requestNumberPanel';
    panel.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 60px 20px;
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border-radius: 12px;
      text-align: center;
      z-index: 10;
    `;

    const submittedDate = new Date(request.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    panel.innerHTML = `
      <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: #dbeafe; border-radius: 50%; animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;">
        <svg style="width: 32px; height: 32px; color: #2563eb;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <polyline points="12 6 12 12 16 14" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <h2 style="margin: 0; color: #1e3a8a; font-size: 24px; font-weight: 700;">Phone Number Requested</h2>
      <p style="margin: 0; color: #475569; max-width: 400px; font-size: 14px; line-height: 1.6;">
        Your request for a dedicated phone number has been received and is currently being processed. 
        Please check back shortly—this page will automatically update with your new number information once it's been provisioned.
      </p>
      <div style="background: linear-gradient(to bottom right, #eff6ff, #dbeafe); border-radius: 12px; padding: 24px; border: 1px solid #bfdbfe; max-width: 400px; width: 100%;">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px;">
            <span style="color: #374151; font-weight: 600;">Request Status:</span>
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: #dbeafe; color: #1e40af; border-radius: 20px; font-size: 12px; font-weight: 700; border: 1px solid #93c5fd;">
              <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke-width="2"/>
                <polyline points="12 6 12 12 16 14" stroke-width="2" stroke-linecap="round"/>
              </svg>
              Processing
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px;">
            <span style="color: #374151; font-weight: 600;">Submitted:</span>
            <span style="color: #111827;">${submittedDate}</span>
          </div>
          ${request.requested_area_code ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px;">
            <span style="color: #374151; font-weight: 600;">Requested Area Code:</span>
            <span style="color: #111827; font-family: monospace;">${request.requested_area_code}</span>
          </div>
          ` : ''}
        </div>
      </div>
      <p style="margin: 0; font-size: 13px; color: #64748b;">Typically processed within 24-48 hours</p>
    `;

    const messagesWrap = document.querySelector('.messages-wrap');
    if (messagesWrap) {
      messagesWrap.style.position = 'relative';
      messagesWrap.appendChild(panel);
    } else {
      chatPanel.innerHTML = '';
      chatPanel.style.position = 'relative';
      chatPanel.appendChild(panel);
    }
  }

  // Update send message form submission
  function attachSendFormListener() {
    msgInput = document.getElementById('msgInput');
    sendForm = document.getElementById('sendForm');
    
    if (!sendForm) return;
    
    sendForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = msgInput.value && msgInput.value.trim();
      if (!text || !activeThreadId) return;

      try {
        const shopId = await getCurrentShopId();
        if (!shopId) return;

        // Send via server API
        const response = await fetch(`${API_BASE_URL}/api/messaging/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: shopId,
            customer_id: activeThread?.customer_id,
            to: activeThread.external_recipient,
            body: text
          })
        });

        if (!response.ok) {
          throw new Error('Failed to send message');
        }

        const result = await response.json();
        console.log('✅ Message sent:', result);

        // Clear input
        msgInput.value = '';

        // Reload messages (will be updated via Realtime soon)
        await loadMessages(activeThreadId);
        await loadThreads(); // Refresh thread list to update last_message

      } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
      }
    });
  }

  // Back button behavior for mobile
  if (threadBackBtn) {
    threadBackBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (chatPanel) chatPanel.classList.remove('mobile-open');
      if (threadsPanel) threadsPanel.classList.remove('mobile-hidden');
      threadBackBtn.classList.add('hidden');
      if (threadCenteredTitle) {
        threadCenteredTitle.classList.add('hidden');
        threadCenteredTitle.textContent = '';
      }
    });
  }

  // Remove Thread Modal logic
  const removeThreadModal = document.getElementById('removeThreadModal');
  const removeThreadMsg = document.getElementById('removeThreadMsg');
  const removeThreadClose = document.getElementById('removeThreadClose');
  const removeThreadCancel = document.getElementById('removeThreadCancel');
  const removeThreadConfirm = document.getElementById('removeThreadConfirm');
  let pendingRemoveThreadId = null;

  function showRemoveThreadModal(threadId) {
    pendingRemoveThreadId = threadId;
    const thread = threads.find(tt => tt.id === threadId);
    if (removeThreadMsg && thread) {
      const displayName = thread.customer 
        ? `${thread.customer.first_name || ''} ${thread.customer.last_name || ''}`.trim() 
        : thread.external_recipient;
      removeThreadMsg.textContent = `Remove thread "${displayName}"? This cannot be undone.`;
    }
    if (removeThreadModal) removeThreadModal.classList.remove('hidden');
  }

  function hideRemoveThreadModal() {
    pendingRemoveThreadId = null;
    if (removeThreadModal) removeThreadModal.classList.add('hidden');
  }

  async function archiveThread(threadId) {
    try {
      const { error } = await supabase
        .from('threads')
        .update({ archived: true })
        .eq('id', threadId);

      if (error) throw error;

      if (activeThreadId === threadId) {
        activeThreadId = null;
        activeThread = null;
        chatBox.innerHTML = '';
        threadTitle.textContent = 'Select a thread';
        threadSubtitle.textContent = '';
        threadAvatar.textContent = '';
      }

      await loadThreads();
    } catch (error) {
      console.error('Error archiving thread:', error);
    }
  }

  // Permanently delete a thread and its messages
  async function deleteThreadPermanent(threadId) {
    try {
      // Delete messages first
      const { error: delMsgsErr } = await supabase
        .from('messages')
        .delete()
        .eq('thread_id', threadId);
      if (delMsgsErr) throw delMsgsErr;

      // Delete the thread row
      const { error: delThreadErr } = await supabase
        .from('threads')
        .delete()
        .eq('id', threadId);
      if (delThreadErr) throw delThreadErr;

      if (activeThreadId === threadId) {
        activeThreadId = null;
        activeThread = null;
        chatBox.innerHTML = '';
        threadTitle.textContent = 'Select a thread';
        threadSubtitle.textContent = '';
        threadAvatar.textContent = '';
      }

      await loadThreads();
    } catch (error) {
      console.error('Error deleting thread permanently:', error);
      alert('Failed to delete thread: ' + (error.message || error));
    }
  }

  if (removeThreadClose) removeThreadClose.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadCancel) removeThreadCancel.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadConfirm) {
    removeThreadConfirm.addEventListener('click', async () => {
      if (!pendingRemoveThreadId) return hideRemoveThreadModal();
      // Perform permanent delete instead of archive
      await deleteThreadPermanent(pendingRemoveThreadId);
      hideRemoveThreadModal();
    });
  }

  // Customer Info Modal (placeholder - needs full implementation like original)
  const custModal = document.getElementById('custModal');
  const custModalClose = document.getElementById('custModalClose');
  const threadInfoBtn = document.getElementById('threadInfoBtn');
  
  if (threadInfoBtn) {
    threadInfoBtn.addEventListener('click', () => {
      if (!activeThread) return;
      const newCustFirst = document.getElementById('newCustFirst');
      const newCustLast = document.getElementById('newCustLast');
      const newCustPhone = document.getElementById('newCustPhone');
      const newCustEmail = document.getElementById('newCustEmail');
      const newCustNotes = document.getElementById('newCustNotes');
      const custVehicleSection = document.getElementById('custVehicleSection');

      // Prefer cached thread fields, then joined customer, then fallback
      if (newCustFirst) newCustFirst.value = activeThread.customer_first || (activeThread.customer ? activeThread.customer.first_name : '') || '';
      if (newCustLast) newCustLast.value = activeThread.customer_last || (activeThread.customer ? activeThread.customer.last_name : '') || '';
      if (newCustPhone) newCustPhone.value = activeThread.phone || (activeThread.customer ? activeThread.customer.phone : '') || '';
      if (newCustEmail) newCustEmail.value = activeThread.email || (activeThread.customer ? activeThread.customer.email : '') || '';
      if (newCustNotes) newCustNotes.value = activeThread.notes || (activeThread.customer ? activeThread.customer.notes : '') || '';
      if (custVehicleSection) custVehicleSection.classList.add('hidden');
      if (custModal) custModal.classList.remove('hidden');
      if (newCustFirst) newCustFirst.focus();
    });
  }

  if (custModalClose) {
    custModalClose.addEventListener('click', () => {
      if (custModal) custModal.classList.add('hidden');
    });
  }

  // Panel heights for desktop
  function updatePanelHeights() {
    // Mobile: show 12 visible threads before scrolling
    if (window.innerWidth < 900) {
      const desiredVisible = 12;
      const itemHeight = 64;
      const gap = 6;
      const listHeight = desiredVisible * itemHeight + (desiredVisible - 1) * gap;
      if (threadListEl) threadListEl.style.maxHeight = listHeight + 'px';
      return;
    }
    // Desktop: show 5 visible threads before scrolling
    const desiredVisible = 5;
    const itemHeight = 64;
    const gap = 6;
    const listHeight = desiredVisible * itemHeight + (desiredVisible - 1) * gap;
    if (threadPanelHeader && messagesWrap && threadListEl) {
      const headerH = threadPanelHeader.offsetHeight;
      const total = headerH + listHeight;
      messagesWrap.style.height = total + 'px';
      threadListEl.style.maxHeight = listHeight + 'px';
    } else {
      if (messagesWrap) messagesWrap.style.minHeight = listHeight + 'px';
      if (threadListEl) threadListEl.style.maxHeight = listHeight + 'px';
    }
  }

  window.addEventListener('resize', updatePanelHeights);

  // Poll for new messages every 3 seconds (alternative to Realtime)
  let pollInterval = null;
  let lastMessageCount = 0;
  
  async function startPolling() {
    const shopId = await getCurrentShopId();
    if (!shopId) return;

    console.log('🔄 Starting message polling (checking every 3 seconds)');

    pollInterval = setInterval(async () => {
      // Only poll if we have an active thread
      if (!activeThreadId) return;
      
      try {
        // Check for new messages
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('thread_id', activeThreadId)
          .order('created_at', { ascending: true });
        
        if (error) {
          console.error('Polling error:', error);
          return;
        }
        
        // If we have more messages than before, append the new ones
        if (data && data.length > messages.length) {
          console.log('📨 New messages detected!', data.length - messages.length, 'new');
          const newMessages = data.slice(messages.length);
          newMessages.forEach(msg => {
            messages.push(msg);
            appendMessageBubble(msg);
          });
          scrollChatToBottom();
          
          // Also reload threads to update last_message
          await loadThreads();
        }
      } catch (err) {
        console.error('Error polling for messages:', err);
      }
    }, 3000); // Poll every 3 seconds
  }
  
  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
      console.log('⏹️ Stopped message polling');
    }
  }
  // New Thread Modal handlers
  function setupNewThreadModal() {
    const newThreadModal = document.getElementById('newThreadModal');
    const newThreadClose = document.getElementById('newThreadClose');
    const newThreadPhone = document.getElementById('newThreadPhone');
    const newThreadSave = document.getElementById('newThreadSave');

    if (newThreadClose) {
      newThreadClose.addEventListener('click', () => {
        if (newThreadModal) newThreadModal.classList.add('hidden');
        if (newThreadPhone) newThreadPhone.value = '';
      });
    }

    if (newThreadSave) {
      newThreadSave.addEventListener('click', async (e) => {
        e.preventDefault();
        let phoneNumber = newThreadPhone?.value?.trim();
        
        if (!phoneNumber) {
          alert('Please enter a phone number');
          return;
        }

        // Normalize the phone number
        phoneNumber = normalizePhone(phoneNumber);
        console.log('Normalized phone:', phoneNumber);

        try {
          newThreadSave.disabled = true;
          newThreadSave.textContent = '...';

          const shopId = await getCurrentShopId();
          if (!shopId) throw new Error('Shop not found');

          // Get shop name from Supabase
          const { data: shop } = await supabase
            .from('shops')
            .select('name')
            .eq('id', shopId)
            .single();
          
          const shopName = shop?.name || 'your shop';

          // Just create thread directly in Supabase without sending a message
          const { data: threadData, error: threadError } = await supabase
            .from('threads')
            .insert({
              shop_id: shopId,
              external_recipient: phoneNumber,
              twilio_number_id: shopTwilioNumber.id,
              last_message_at: new Date().toISOString()
            })
            .select()
            .single();

          if (threadError) throw threadError;

          console.log('✅ Thread created:', threadData);

          // Close modal and reload threads
          if (newThreadModal) newThreadModal.classList.add('hidden');
          if (newThreadPhone) newThreadPhone.value = '';
          await loadThreads();
          
          // Auto-open the new thread
          if (threadData?.id) {
            await openThread(threadData.id);
          }

        } catch (error) {
          console.error('Error creating thread:', error);
          alert(`Error: ${error.message}`);
        } finally {
          newThreadSave.disabled = false;
          newThreadSave.textContent = '+';
        }
      });
    }

    // Allow Enter key to send
    if (newThreadPhone) {
      newThreadPhone.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          newThreadSave?.click();
        }
      });
    }
  }

  // Initialize
  async function init() {
    await loadShopTwilioNumber();
    await loadThreads();
    attachSendFormListener();
    setupNewThreadModal();
    updatePanelHeights();
    startPolling(); // Start polling for new messages
  }
  
  // Clean up on page unload
  window.addEventListener('beforeunload', stopPolling);

  init();
}

export { setupMessages };
