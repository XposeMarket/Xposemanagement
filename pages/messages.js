/**
 * pages/messages.js
 * Messages page setup
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

function setupMessages() {
  console.log('📄 setupMessages initializing');

  // Demo data (in-memory)
  const demoThreads = JSON.parse(localStorage.getItem('xm_demo_threads') || 'null') || [
    {
      id: 't1',
      name: 'Eliza Block',
      avatar: '',
      last: 'See you Saturday at 1pm',
      messages: [
        {id:'m1', from:'them', text:'Hey, want to grab lunch this weekend?', time: Date.now()-3600*24*3},
        {id:'m2', from:'me', text:'How about 1pm?', time: Date.now()-3600*24*3+60000},
        {id:'m3', from:'them', text:"Perfect, I've been wanting to go!", time: Date.now()-3600*24*3+120000}
      ]
    },
    {
      id: 't2',
      name: 'Demo2@Demo.com',
      avatar: '',
      last: 'Thanks for the update',
      messages: [
        {id:'m4', from:'them', text:'Vehicle ready for pickup', time: Date.now()-3600*6},
        {id:'m5', from:'me', text:'Great, I will swing by later', time: Date.now()-3600*5}
      ]
    }
  ];

  // Save to localStorage for session persistence
  if (!localStorage.getItem('xm_demo_threads')) localStorage.setItem('xm_demo_threads', JSON.stringify(demoThreads));

  const threadListEl = document.getElementById('threadList');
  const chatBox = document.getElementById('chatBox');
  const threadTitle = document.getElementById('threadTitle');
  const threadSubtitle = document.getElementById('threadSubtitle');
  const threadAvatar = document.getElementById('threadAvatar');
  const msgInput = document.getElementById('msgInput');
  const sendForm = document.getElementById('sendForm');
  const newThreadBtn = document.getElementById('newThreadBtn');
  const editThreadsBtn = document.getElementById('editThreadsBtn');
  let editMode = false;

  let threads = demoThreads;
  let activeThreadId = null;
  // search filter for threads/customers
  const threadSearchInput = document.getElementById('threadSearch');
  let threadFilter = '';
  if (threadSearchInput) {
    threadSearchInput.addEventListener('input', (ev) => {
      threadFilter = (ev.target.value || '').toLowerCase();
      renderThreadList();
    });
  }

  // Remove Thread Modal logic (single initialization)
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
      removeThreadMsg.textContent = `Remove thread "${thread.name || thread.recipient || 'New Message'}"? This cannot be undone.`;
    }
    if (removeThreadModal) removeThreadModal.classList.remove('hidden');
  }
  function hideRemoveThreadModal() {
    pendingRemoveThreadId = null;
    if (removeThreadModal) removeThreadModal.classList.add('hidden');
  }
  if (removeThreadClose) removeThreadClose.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadCancel) removeThreadCancel.addEventListener('click', hideRemoveThreadModal);
  if (removeThreadConfirm) removeThreadConfirm.addEventListener('click', () => {
    if (!pendingRemoveThreadId) return hideRemoveThreadModal();
    threads = threads.filter(tt => tt.id !== pendingRemoveThreadId);
    localStorage.setItem('xm_demo_threads', JSON.stringify(threads));
    if (activeThreadId === pendingRemoveThreadId) {
      activeThreadId = null;
      chatBox.innerHTML = '';
      threadTitle.textContent = 'Select a thread';
      threadSubtitle.textContent = '';
      threadAvatar.textContent = '';
    }
    renderThreadList();
    hideRemoveThreadModal();
  });

  // Customer modal elements in Messages page
  const custModal = document.getElementById('custModal');
  const custModalClose = document.getElementById('custModalClose');
  const newCustCancel = document.getElementById('newCustCancel');
  const newCustSave = document.getElementById('newCustSave');
  const newCustSaveAddVeh = document.getElementById('newCustSaveAddVeh');
  const newCustNewAppt = document.getElementById('newCustNewAppt');
  const newCustFirst = document.getElementById('newCustFirst');
  const newCustLast = document.getElementById('newCustLast');
  const newCustPhone = document.getElementById('newCustPhone');
  const newCustEmail = document.getElementById('newCustEmail');
  const newCustNotes = document.getElementById('newCustNotes');
  const custVehicleSection = document.getElementById('custVehicleSection');
  const custVehYear = document.getElementById('custVehYear');
  const custVehMake = document.getElementById('custVehMake');
  const custVehModel = document.getElementById('custVehModel');
  const custVehVin = document.getElementById('custVehVin');

  const askAddVehicleModal = document.getElementById('askAddVehicleModal');
  const askAddVehicleYes = document.getElementById('askAddVehicleYes');
  const askAddVehicleNo = document.getElementById('askAddVehicleNo');
  const askAddVehicleClose = document.getElementById('askAddVehicleClose');

  // Mobile UI elements
  const chatPanel = document.querySelector('.chat-panel');
  const threadsPanel = document.querySelector('.threads-panel');
  const threadBackBtn = document.getElementById('threadBackBtn');
  const threadCenteredTitle = document.getElementById('threadCenteredTitle');

  // wire info button
  const threadInfoBtn = document.getElementById('threadInfoBtn');
  if (threadInfoBtn) {
    threadInfoBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const thread = threads.find(t => t.id === activeThreadId);
      if (!thread) return;
      // Prefill customer info for all threads
      const source = (thread.name || thread.recipient || '').toString().trim();
      const isEmail = /@/.test(source);
      const isPhone = /^[\d\+\-\s\(\)]+$/.test(source);
      if (isEmail) {
        if (newCustEmail) newCustEmail.value = source;
        if (newCustFirst) newCustFirst.value = '';
        if (newCustLast) newCustLast.value = '';
        if (newCustPhone) newCustPhone.value = '';
      } else if (isPhone) {
        if (newCustPhone) newCustPhone.value = source;
        if (newCustFirst) newCustFirst.value = '';
        if (newCustLast) newCustLast.value = '';
        if (newCustEmail) newCustEmail.value = '';
      } else if (source) {
        const parts = source.split(/\s+/);
        if (newCustFirst) newCustFirst.value = parts[0] || '';
        if (newCustLast) newCustLast.value = parts.slice(1).join(' ') || '';
        if (newCustPhone) newCustPhone.value = '';
        if (newCustEmail) newCustEmail.value = '';
      } else {
        if (newCustFirst) newCustFirst.value = '';
        if (newCustLast) newCustLast.value = '';
        if (newCustPhone) newCustPhone.value = '';
        if (newCustEmail) newCustEmail.value = '';
      }
      if (newCustNotes) newCustNotes.value = '';
      if (custVehicleSection) custVehicleSection.classList.add('hidden');
      if (custModal) custModal.classList.remove('hidden');
      if (newCustFirst) newCustFirst.focus();
    });
  }

  if (custModalClose) custModalClose.addEventListener('click', () => { if (custModal) custModal.classList.add('hidden'); });
  if (newCustCancel) newCustCancel.addEventListener('click', () => { if (custModal) custModal.classList.add('hidden'); });

  function saveCustomerToLocal() {
    const first = (newCustFirst && newCustFirst.value.trim()) || '';
    const last = (newCustLast && newCustLast.value.trim()) || '';
    const phone = (newCustPhone && newCustPhone.value.trim()) || '';
    const email = (newCustEmail && newCustEmail.value.trim()) || '';
    const notes = (newCustNotes && newCustNotes.value.trim()) || '';
    if (!first && !last) {
      alert('Please enter a first or last name');
      return null;
    }
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'c-' + Date.now();
    const customer = { id, customer_first: first, customer_last: last, phone, email, notes, created_at: new Date().toISOString() };
    try {
      const arr = JSON.parse(localStorage.getItem('xm_customers') || '[]');
      arr.push(customer);
      localStorage.setItem('xm_customers', JSON.stringify(arr));
    } catch (e) {
      localStorage.setItem('xm_customers', JSON.stringify([customer]));
    }
    return customer;
  }

  if (newCustSave) {
    newCustSave.addEventListener('click', () => {
      const saved = saveCustomerToLocal();
      if (saved) {
        if (custModal) custModal.classList.add('hidden');
        // update the active thread name if first/last provided
        if (activeThreadId && (saved.customer_first || saved.customer_last)) {
          const t = threads.find(x => x.id === activeThreadId);
          if (t) {
            t.name = `${saved.customer_first} ${saved.customer_last}`.trim();
            // persist threads
            localStorage.setItem('xm_demo_threads', JSON.stringify(threads));
            renderThreadList();
          }
        }
        alert('Customer saved locally');
      }
    });
  }

  if (newCustSaveAddVeh) {
    newCustSaveAddVeh.addEventListener('click', () => {
      const saved = saveCustomerToLocal();
      if (saved) {
        // show ask add vehicle modal
        if (askAddVehicleModal) askAddVehicleModal.classList.remove('hidden');
      }
    });
  }

  if (askAddVehicleClose) askAddVehicleClose.addEventListener('click', () => { if (askAddVehicleModal) askAddVehicleModal.classList.add('hidden'); });
  if (askAddVehicleNo) askAddVehicleNo.addEventListener('click', () => { if (askAddVehicleModal) askAddVehicleModal.classList.add('hidden'); if (custModal) custModal.classList.add('hidden'); });
  if (askAddVehicleYes) askAddVehicleYes.addEventListener('click', () => {
    // hide ask modal and show vehicle section in cust modal
    if (askAddVehicleModal) askAddVehicleModal.classList.add('hidden');
    if (custVehicleSection) custVehicleSection.classList.remove('hidden');
  });

  if (newCustNewAppt) {
    newCustNewAppt.addEventListener('click', () => {
      // save customer locally and navigate to appointments with prefill
      const saved = saveCustomerToLocal();
      if (!saved) return;
      // update active thread name if possible
      if (activeThreadId && (saved.customer_first || saved.customer_last)) {
        const t = threads.find(x => x.id === activeThreadId);
        if (t) {
          t.name = `${saved.customer_first} ${saved.customer_last}`.trim();
          localStorage.setItem('xm_demo_threads', JSON.stringify(threads));
          renderThreadList();
        }
      }
      // build prefill object appointments.js expects
      const pre = {
        customer_first: saved.customer_first,
        customer_last: saved.customer_last,
        email: saved.email || '',
        phone: saved.phone || '',
        vehicle_year: custVehYear?.value || '',
        vehicle_make: custVehMake?.value || '',
        vehicle_model: custVehModel?.value || ''
      };
      localStorage.setItem('newApptCustomer', JSON.stringify(pre));
      // if vehicle fields present, set newApptVehicle
      if (custVehYear && (custVehYear.value || custVehMake.value || custVehModel.value || custVehVin.value)) {
        const veh = { year: custVehYear.value, make: custVehMake.value, model: custVehModel.value, vin: custVehVin.value };
        localStorage.setItem('newApptVehicle', JSON.stringify(veh));
      }
      // navigate to appointments page and open new modal via #new hash
      window.location.href = 'appointments.html#new';
    });
  }

  // Panel sizing: compute heights so 5 threads are visible before scrolling
  const threadPanelHeader = document.getElementById('threadPanelHeader');
  const messagesWrap = document.querySelector('.messages-wrap');

  function updatePanelHeights() {
    // Mobile: show 12 visible threads before scrolling
    if (window.innerWidth < 900) {
      const desiredVisible = 12;
      const itemHeight = 64; // matches .thread-item height
      const gap = 6; // margin between items
      const listHeight = desiredVisible * itemHeight + (desiredVisible - 1) * gap; // 834px
      if (threadListEl) threadListEl.style.maxHeight = listHeight + 'px';
      return;
    }
    // Desktop: show 5 visible threads before scrolling
    const desiredVisible = 5;
    const itemHeight = 64; // matches .thread-item height
    const gap = 6; // margin between items
    const listHeight = desiredVisible * itemHeight + (desiredVisible - 1) * gap; // 344px
    if (threadPanelHeader && messagesWrap && threadListEl) {
      const headerH = threadPanelHeader.offsetHeight;
      const total = headerH + listHeight;
      messagesWrap.style.height = total + 'px';
      threadListEl.style.maxHeight = listHeight + 'px';
    } else {
      // fallback to min sizes
      if (messagesWrap) messagesWrap.style.minHeight = listHeight + 'px';
      if (threadListEl) threadListEl.style.maxHeight = listHeight + 'px';
    }
  }
  // recompute on resize
  window.addEventListener('resize', updatePanelHeights);

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  }

  function renderThreadList() {
    threadListEl.innerHTML = '';
    const list = threads.filter(t => {
      if (!threadFilter) return true;
      const hay = `${(t.name||'')}${(t.recipient||'')}${(t.last||'')}`.toLowerCase();
      return hay.indexOf(threadFilter) !== -1;
    });
    list.forEach(t => {
      const item = document.createElement('div');
      item.className = 'thread-item';
      item.style.cssText = 'display:flex;gap:12px;padding:10px;border-radius:8px;align-items:center;cursor:pointer';
      if (t.id === activeThreadId) item.style.background = 'linear-gradient(90deg, rgba(59,130,246,0.08), rgba(59,130,246,0.03))';
      const av = document.createElement('div'); av.style.cssText = 'width:44px;height:44px;border-radius:8px;background:#e6eefc;flex:0 0 44px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e40af'; av.textContent = (t.name||t.recipient||'').slice(0,1).toUpperCase();
      const meta = document.createElement('div'); meta.style.cssText = 'flex:1;min-width:0;';
      const name = document.createElement('div'); name.style.cssText='font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; name.textContent = t.name || t.recipient || 'New Message';
      const last = document.createElement('div'); last.style.cssText='font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; last.textContent = t.last || (t.messages && t.messages.length ? t.messages[t.messages.length-1].text : '');
      meta.appendChild(name); meta.appendChild(last);
      const controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:8px;align-items:center;flex:0 0 auto';
      const time = document.createElement('div'); time.style.cssText='font-size:11px;color:var(--muted);flex:0 0 auto'; time.textContent = t.messages && t.messages.length ? formatTime(t.messages[t.messages.length-1].time) : '';
      controls.appendChild(time);
      if (editMode) {
        const del = document.createElement('button');
        del.className = 'btn small danger';
        del.textContent = 'Delete';
        del.addEventListener('click', (ev) => { ev.stopPropagation(); showRemoveThreadModal(t.id); });
        controls.appendChild(del);
      }
      item.appendChild(av); item.appendChild(meta); item.appendChild(controls);
      item.addEventListener('click', () => { if (!editMode) openThread(t.id); });
      threadListEl.appendChild(item);
    });
  }

  function openThread(id) {
    const thread = threads.find(x => x.id === id);
    if (!thread) return;
    activeThreadId = id;
    // If this is a newly created thread (no recipient yet), render an input for the number
    if (thread._isNew) {
      threadTitle.innerHTML = `<input id="recipientInput" type="tel" placeholder="Enter phone number" style="width:220px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);" />`;
      // wire input events
      const recipientInput = document.getElementById('recipientInput');
      if (recipientInput) {
        recipientInput.value = thread.recipient || '';
        recipientInput.focus();
        recipientInput.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            // move focus to message composer
            msgInput.focus();
          }
        });
        recipientInput.addEventListener('input', (ev) => { thread.recipient = ev.target.value; });
      }
      threadSubtitle.textContent = '';
      threadAvatar.textContent = (thread.recipient || '').slice(0,1).toUpperCase() || '';
    } else {
      threadTitle.textContent = thread.name;
      threadSubtitle.textContent = thread.last || '';
      threadAvatar.textContent = (thread.name || '').slice(0,1).toUpperCase();
    }
    renderThreadList();
    renderMessages(thread);
    // Mobile behavior: slide chat into view, hide threads panel, show back button/centered title
    if (window.innerWidth < 900) {
      if (chatPanel) chatPanel.classList.add('mobile-open');
      if (threadsPanel) threadsPanel.classList.add('mobile-hidden');
      if (threadBackBtn) threadBackBtn.classList.remove('hidden');
      if (threadCenteredTitle) {
        threadCenteredTitle.classList.remove('hidden');
        // Show request number and Coming Soon label for mobile
        let reqNum = thread.id ? `Request #${thread.id}` : '';
        let title = thread.name || thread.recipient || 'Chat';
        threadCenteredTitle.innerHTML = `
          <div style="font-weight:600;">${title}</div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px;">${reqNum}</div>
          <div style="font-size:13px;color:#f59e42;margin-top:4px;font-weight:500;">Coming Soon</div>
        `;
      }
    }
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

  function renderMessages(thread) {
    chatBox.innerHTML = '';
    thread.messages.forEach(m => {
      appendMessageBubble(m);
    });
    scrollChatToBottom();
  }

  function appendMessageBubble(m) {
    const div = document.createElement('div');
    div.className = 'msg-row';
    div.style.display = 'flex';
    if (m.from === 'me') {
      div.style.justifyContent = 'flex-end';
      div.innerHTML = `<div class="bubble outgoing">${escapeHtml(m.text)}<div class="bubble-time">${formatTime(m.time)}</div></div>`;
    } else {
      div.style.justifyContent = 'flex-start';
      div.innerHTML = `<div class="bubble incoming">${escapeHtml(m.text)}<div class="bubble-time">${formatTime(m.time)}</div></div>`;
    }
    chatBox.appendChild(div);
  }

  function scrollChatToBottom() { chatBox.scrollTop = chatBox.scrollHeight; }

  function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  sendForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value && msgInput.value.trim();
    if (!text || !activeThreadId) return;
    const thread = threads.find(t => t.id === activeThreadId);
    // If this is a new thread, require recipient
    if (thread._isNew) {
      const recipientInput = document.getElementById('recipientInput');
      const recip = recipientInput ? (recipientInput.value && recipientInput.value.trim()) : (thread.recipient || '');
      if (!recip) {
        // focus recipient input
        if (recipientInput) recipientInput.focus();
        return;
      }
      // set thread name/recipient and clear new flag
      thread.recipient = recip;
      thread.name = recip;
      thread._isNew = false;
    }
    const msg = { id: 'm'+Date.now(), from: 'me', text, time: Date.now() };
    thread.messages.push(msg);
    thread.last = text;
    appendMessageBubble(msg);
    msgInput.value = '';
    scrollChatToBottom();
    // persist demo threads to localStorage
    localStorage.setItem('xm_demo_threads', JSON.stringify(threads));
    renderThreadList();
  });

  // New thread button behavior - create a lightweight new thread and open it
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = 'new-' + Date.now();
      const thread = { id, name: '', recipient: '', last: '', messages: [], _isNew: true };
      // prepend to threads list
      threads.unshift(thread);
      // persist to storage
      localStorage.setItem('xm_demo_threads', JSON.stringify(threads));
      renderThreadList();
      openThread(id);
      updatePanelHeights();
      // Show green confirmation banner
      if (window.showConfirmationBanner) {
        window.showConfirmationBanner('New thread created!');
      }
    });
  }
  if (editThreadsBtn) {
    editThreadsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      editMode = !editMode;
      editThreadsBtn.textContent = editMode ? 'Done' : 'Edit';
      renderThreadList();
      updatePanelHeights();
    });
  }

  // initial render
  renderThreadList();
  // auto-open first thread
  if (threads.length) openThread(threads[0].id);
  // initial sizing
  updatePanelHeights();
}

export { setupMessages };
