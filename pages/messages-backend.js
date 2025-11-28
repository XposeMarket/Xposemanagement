/**
 * pages/messages-backend.js
 * Backend-integrated Messages page (Twilio + Supabase)
 * 
 * Imported by: app.js (replaces pages/messages.js)
 * Imports from: helpers/
 */

import { supabase } from '../helpers/supabase.js';
import { currentShop } from '../helpers/user.js';

function setupMessages() {
  console.log('📄 setupMessages (backend) initializing');

  const threadListEl = document.getElementById('threadList');
  const chatBox = document.getElementById('chatBox');
  const threadTitle = document.getElementById('threadTitle');
  const threadSubtitle = document.getElementById('threadSubtitle');
  const threadAvatar = document.getElementById('threadAvatar');
  const threadCenteredTitle = document.getElementById('threadCenteredTitle');
  const msgInput = document.getElementById('msgInput');
  const sendForm = document.getElementById('sendForm');
  const newThreadBtn = document.getElementById('newThreadBtn');
  const editThreadsBtn = document.getElementById('editThreadsBtn');
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
  
  // search filter for threads/customers
  const threadSearchInput = document.getElementById('threadSearch');
  let threadFilter = '';
  if (threadSearchInput) {
    threadSearchInput.addEventListener('input', (ev) => {
      threadFilter = (ev.target.value || '').toLowerCase();
      renderThreadList();
    });
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

  // Get current shop ID
  async function getCurrentShopId() {
    const shop = await currentShop();
    return shop?.id;
  }

  // Load threads from Supabase
  async function loadThreads() {
    try {
      const shopId = await getCurrentShopId();
      if (!shopId) {
        console.error('No shop ID found');
        return;
      }

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
      const customerName = t.customer ? `${t.customer.first_name || ''} ${t.customer.last_name || ''}`.trim() : '';
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
      const displayName = t.customer ? `${t.customer.first_name || ''} ${t.customer.last_name || ''}`.trim() : t.external_recipient;
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

  // Open a thread
  async function openThread(id) {
    const thread = threads.find(x => x.id === id);
    if (!thread) return;

    activeThreadId = id;
    activeThread = thread;

    const displayName = thread.customer 
      ? `${thread.customer.first_name || ''} ${thread.customer.last_name || ''}`.trim() 
      : thread.external_recipient;

    threadTitle.textContent = displayName || 'Unknown';
    threadSubtitle.textContent = thread.external_recipient || '';
    threadAvatar.textContent = (displayName || 'U').slice(0,1).toUpperCase();

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

  // Scroll chat to bottom
  function scrollChatToBottom() { 
    chatBox.scrollTop = chatBox.scrollHeight; 
  }

  // Send message
  sendForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = msgInput.value && msgInput.value.trim();
    if (!text || !activeThreadId) return;

    try {
      const shopId = await getCurrentShopId();
      if (!shopId) return;

      // Send via server API
      const response = await fetch('/api/messaging/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          threadId: activeThreadId,
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

  // New thread button (placeholder - requires phone input UI)
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const phoneNumber = prompt('Enter customer phone number:');
      if (!phoneNumber) return;

      try {
        const shopId = await getCurrentShopId();
        if (!shopId) return;

        // Send initial message to create thread
        const response = await fetch('/api/messaging/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId,
            to: phoneNumber,
            body: 'Hi, this is ' + (await currentShop())?.name || 'your shop'
          })
        });

        if (!response.ok) {
          throw new Error('Failed to create thread');
        }

        // Reload threads
        await loadThreads();

      } catch (error) {
        console.error('Error creating thread:', error);
        alert('Failed to create thread. Please try again.');
      }
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

  if (removeThreadClose) removeThreadClose.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadCancel) removeThreadCancel.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadConfirm) {
    removeThreadConfirm.addEventListener('click', async () => {
      if (!pendingRemoveThreadId) return hideRemoveThreadModal();
      await archiveThread(pendingRemoveThreadId);
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
      // Open customer modal with thread customer data
      // TODO: Implement full customer modal logic
      alert('Customer info modal - to be implemented');
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

  // Subscribe to Realtime updates for new messages
  async function subscribeToMessages() {
    const shopId = await getCurrentShopId();
    if (!shopId) return;

    // Subscribe to new messages
    const messagesChannel = supabase
      .channel('messages')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `shop_id=eq.${shopId}`
        }, 
        async (payload) => {
          console.log('📨 New message received:', payload);
          
          // If message is for active thread, append it
          if (payload.new.thread_id === activeThreadId) {
            messages.push(payload.new);
            appendMessageBubble(payload.new);
            scrollChatToBottom();
          }
          
          // Reload threads to update last_message
          await loadThreads();
        }
      )
      .subscribe();

    // Subscribe to thread updates
    const threadsChannel = supabase
      .channel('threads')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'threads',
          filter: `shop_id=eq.${shopId}`
        },
        async (payload) => {
          console.log('🔄 Thread updated:', payload);
          await loadThreads();
        }
      )
      .subscribe();
  }

  // Initialize
  async function init() {
    await loadThreads();
    updatePanelHeights();
    await subscribeToMessages();
  }

  init();
}

export { setupMessages };
