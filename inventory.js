// inventory.js
// Handles inventory CRUD UI for inventory.html

import { INVENTORY_LOW_THRESHOLD } from './helpers/constants.js';
import { setupInventoryPricing } from './helpers/inventory-pricing.js';

let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
// Folders (preset categories like Oil)
let inventoryFolders = JSON.parse(localStorage.getItem('inventoryFolders') || '[]');

// DOM references (initialized in setupInventory)
let inventoryGrid;
let inventoryEmpty;
let btnNewItem;
let inventoryModal;
let inventoryModalClose;
let inventoryForm;
let editItemId;
let itemName;
let itemQty;
let inventoryModalTitle;
let totalItems;
let lowStock;
// Folder order modal refs
let folderOrderModal;
let folderOrderTitle;
let folderOrderQty;
let folderOrderConfirm;
let folderOrderCancel;
let folderOrderCloseBtn;
let _folderOrderCurrent = { fIdx: null, tIdx: null };
// Reference to the currently-open folder's render function so we can refresh it
let currentFolderRender = null;
// Index of the folder item currently being edited inside an open folder modal
let currentFolderEditIndex = null;
// Confirmation modal refs
let confirmModal;
let confirmMessageEl;
let confirmYesBtn;
let confirmNoBtn;

// Top-level confirm dialog helper (uses modal refs assigned in setupInventory)
function confirmDialog(message) {
  return new Promise(resolve => {
    if (!confirmModal || !confirmYesBtn || !confirmNoBtn || !confirmMessageEl) {
      // fallback to native confirm
      try { resolve(window.confirm(message)); } catch (e) { resolve(false); }
      return;
    }
    confirmMessageEl.textContent = message;
    // theme this confirm modal like Jobs' green confirmation banner
    confirmModal.classList.add('confirm-theme');
    confirmModal.classList.remove('hidden');
    confirmModal.setAttribute('aria-hidden', 'false');

    const cleanup = () => {
      confirmModal.classList.remove('confirm-theme');
      confirmModal.classList.add('hidden');
      confirmModal.setAttribute('aria-hidden', 'true');
      confirmYesBtn.removeEventListener('click', onYes);
      confirmNoBtn.removeEventListener('click', onNo);
    };

    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };

    confirmYesBtn.addEventListener('click', onYes);
    confirmNoBtn.addEventListener('click', onNo);
  });
}

function renderInventory() {
  if (!inventoryGrid) return;
  inventoryGrid.innerHTML = '';
  // render folder panels first
  renderFolders();
  // apply search filter if present
  const searchVal = (inventorySearchValue || '').trim().toLowerCase();
  const itemsToRender = searchVal ? inventory.filter(it => (it.name||"").toLowerCase().includes(searchVal)) : inventory;
  if (!itemsToRender.length) {
    inventoryEmpty.style.display = '';
    totalItems.textContent = '0';
    lowStock.textContent = '0';
    return;
  }
  inventoryEmpty.style.display = 'none';
  let low = 0;
  // Centralized low-stock threshold
  const LOW_THRESHOLD = typeof INVENTORY_LOW_THRESHOLD === 'number' ? INVENTORY_LOW_THRESHOLD : 3;
  itemsToRender.forEach((item, idxFiltered) => {
    // find original index for operations
    const idx = inventory.indexOf(item);
    if ((parseInt(item.qty,10) || 0) < 3) low++;

    const card = document.createElement('div');
    card.className = 'inventory-card card';
    // Determine running-low label for regular items (threshold < 3)
    const runningLowLabel = ((parseInt(item.qty,10) || 0) <= (typeof LOW_THRESHOLD === 'number' ? LOW_THRESHOLD : 3)) ? ' <span style="color:#dc2626;font-weight:700">(Running low)</span>' : '';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div style="flex:1">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name)}</div>
          <div style="color:var(--muted);font-size:13px">In Stock: <strong>${item.qty}</strong>${runningLowLabel}</div>
          ${ item.sell_price != null ? `<div style="color:#10b981;font-size:12px;margin-top:6px">Price: $${Number(item.sell_price).toFixed(2)}</div>` : '' }
          ${ item.cost_price != null ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">Cost: $${Number(item.cost_price).toFixed(2)}</div>` : '' }
          ${ (item.sell_price != null && item.cost_price != null) ? (function(){ const profit = Number(item.sell_price) - Number(item.cost_price); const pct = Number(item.cost_price) > 0 ? Math.round((profit / Number(item.cost_price)) * 100) : null; return `<div style="color:#10b981;font-size:12px;margin-top:6px">Profit: $${profit.toFixed(2)}${pct!=null?` (${pct}%)`:''}</div>` })() : '' }
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <div style="display:flex;gap:8px;">
            <button class="btn" data-order="${idx}" aria-label="Order">Order</button>
            <button class="btn" data-edit="${idx}" aria-label="Edit">Edit</button>
          </div>
          <div>
            <button class="btn danger" data-delete="${idx}" aria-label="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    const editBtn = card.querySelector('[data-edit]');
    if (editBtn) editBtn.addEventListener('click', () => {
      // Open the existing inventory edit modal and populate fields
      if (!inventoryModal || !inventoryForm) return;
      const it = inventory[idx] || {};
      if (inventoryModalTitle) inventoryModalTitle.textContent = 'Edit Inventory Item';
      try { inventoryForm.reset(); } catch (e) {}
      if (editItemId) editItemId.value = String(idx);
      if (itemName) itemName.value = it.name || '';
      if (itemQty) itemQty.value = (it.qty != null ? String(it.qty) : '0');
      const costEl = document.getElementById('itemCostPrice');
      const sellEl = document.getElementById('itemSellPrice');
      if (costEl) costEl.value = (it.cost_price != null ? String(it.cost_price) : '');
      if (sellEl) sellEl.value = (it.sell_price != null ? String(it.sell_price) : '');
      // Update pricing calc UI
      try { updateInventoryModalPricingDisplay(); } catch (e) {}
      inventoryModal.classList.remove('hidden'); inventoryModal.setAttribute('aria-hidden','false');
    });
    const orderBtn = card.querySelector('[data-order]');
    if (orderBtn) orderBtn.addEventListener('click', () => {
      if (window.openOrderModalForItem) window.openOrderModalForItem(idx);
    });

    const delBtn = card.querySelector('[data-delete]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(`Remove item "${item.name}" from inventory?`);
      if (!ok) return;
      // If item has remote UUID, delete remotely first
      try {
        let shopId = null;
        try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch (e) {}
        if (item.id) {
          const { deleteInventoryItemRemote } = await import('./helpers/inventory-api.js');
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item.id));
          if (isUUID) {
            const res = await deleteInventoryItemRemote(item.id);
            if (!res) {
              try { showNotification && showNotification('Failed to delete item from remote', 'error'); } catch (e) {}
              return;
            }
          }
        }
      } catch (e) {
        console.warn('Remote delete failed', e);
        try { showNotification && showNotification('Failed to delete item from remote', 'error'); } catch (e) {}
        return;
      }
      // Remove locally and persist
      inventory.splice(idx, 1);
      try { localStorage.setItem('inventory', JSON.stringify(inventory)); } catch (e) { console.warn('Could not save inventory', e); }
      renderInventory();
      try {
        if (typeof showNotification === 'function') showNotification(`Removed item "${item.name}" from inventory`, 'success');
        else if (typeof window.showConfirmationBanner === 'function') window.showConfirmationBanner(`Removed item "${item.name}" from inventory`);
      } catch (e) {}
    });

    // show last order date
    if (item.lastOrder) {
      const lastNode = document.createElement('div');
      lastNode.className = 'last-order';
      try {
        lastNode.textContent = 'Last Placed order: ' + new Date(item.lastOrder).toLocaleString();
      } catch (e) {
        lastNode.textContent = 'Last Placed order: ' + item.lastOrder;
      }
      card.appendChild(lastNode);
    }

    inventoryGrid.appendChild(card);
  });

  totalItems.textContent = inventory.length;
  // show lowest-stock item name instead of number
  const lowEl = document.getElementById('lowStockItem');
  if (lowEl) {
    // Show number of low-stock items (regular inventory items with qty < 3)
    lowEl.textContent = String(low || 0);
  }

  // Render right-hand activity lists in left panel
  try {
    const recentEl = document.getElementById('recentOrdered');
    const staleEl = document.getElementById('staleOrdered');
    if (recentEl && staleEl) {
      const now = Date.now();
      const recentDays = 30; // last 30 days
      const staleDays = 90; // older than 90 days or never ordered
      const recentThreshold = now - (recentDays * 24 * 60 * 60 * 1000);
      const staleThreshold = now - (staleDays * 24 * 60 * 60 * 1000);

      const withOrder = inventory.filter(it => it.lastOrder).map(it => ({...it, last: new Date(it.lastOrder).getTime()})).sort((a,b) => b.last - a.last);
      const recent = withOrder.filter(it => it.last >= recentThreshold).slice(0,5);
      const stale = inventory.filter(it => !it.lastOrder || (new Date(it.lastOrder).getTime() < staleThreshold)).slice(0,5);

      // Render recent as dashboard-style rows
      recentEl.innerHTML = '';
      if (!recent.length) recentEl.innerHTML = '<p class="notice">No recent orders</p>';
      recent.forEach(it => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card);margin-bottom:6px;font-size:13px';
        row.innerHTML = `<div><b>${escapeHtml(it.name)}</b><br><span class="notice">${new Date(it.lastOrder).toLocaleDateString()}</span></div>`;
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--line)'; row.style.transform = 'translateX(4px)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'var(--card)'; row.style.transform = 'translateX(0)'; });
        recentEl.appendChild(row);
      });

      staleEl.innerHTML = '';
      if (!stale.length) staleEl.innerHTML = '<p class="notice">No stale items</p>';
      stale.forEach(it => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card);margin-bottom:6px;font-size:13px';
        const when = it.lastOrder ? new Date(it.lastOrder).toLocaleDateString() : 'never';
        row.innerHTML = `<div><b>${escapeHtml(it.name)}</b><br><span class="notice">${when}</span></div>`;
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--line)'; row.style.transform = 'translateX(4px)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'var(--card)'; row.style.transform = 'translateX(0)'; });
        staleEl.appendChild(row);
      });
    }
  } catch (e) {
    console.warn('Could not render activity lists', e);
  }

  // Render Out of Stock panel on the right sidebar
  try {
    renderOutOfStockPanel();
  } catch (e) {
    console.warn('Could not render Out of Stock panel', e);
  }
}

// Helper to mark an item as out of stock when its qty reaches 0
function updateOutOfStockFlag(obj) {
  try {
    const q = parseInt(obj.qty, 10) || 0;
    if (q <= 0) {
      if (!obj.outOfStockDate) obj.outOfStockDate = new Date().toISOString();
    } else {
      if (obj.outOfStockDate) delete obj.outOfStockDate;
    }
  } catch (e) {}
}

function renderOutOfStockPanel() {
  const right = document.querySelector('.right-sidebar');
  if (!right) return;
  right.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  const header = document.createElement('h3'); header.style.margin = '0'; header.textContent = 'Out of Stock';
  card.appendChild(header);
  const list = document.createElement('div'); list.style.marginTop = '8px';

  // Collect items from inventory with qty === 0
  const outItems = [];
  (inventory || []).forEach((it, i) => {
    const q = parseInt(it.qty, 10) || 0;
    if (q <= 0) outItems.push({ type: 'inventory', name: it.name, idx: i, qty: q, date: it.outOfStockDate });
  });

  // Collect folder items with qty === 0
  (inventoryFolders || []).forEach((folder, fIdx) => {
    (folder.items || []).forEach((it, tIdx) => {
      const q = parseInt(it.qty, 10) || 0;
      if (q <= 0) outItems.push({ type: 'folder', name: it.name, fIdx, tIdx, qty: q, date: it.outOfStockDate, folderName: folder.name });
    });
  });

  if (!outItems.length) {
    list.textContent = 'No out of stock items';
    card.appendChild(list);
    right.appendChild(card);
    return;
  }

  outItems.forEach(it => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card);display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px';
    const left = document.createElement('div');
    left.innerHTML = `<div style="font-weight:700">${escapeHtml(it.name)}</div><div style="font-size:12px;color:var(--muted)">${it.type === 'folder' ? escapeHtml(it.folderName) + ' — ' : ''}Out of Stock: ${it.date ? new Date(it.date).toLocaleDateString() : 'Unknown'}</div>`;
    const rightActions = document.createElement('div');
    const orderBtn = document.createElement('button'); orderBtn.className = 'btn'; orderBtn.textContent = 'Order';
    orderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.type === 'inventory') window.openOrderModalForItem(`inventory:${it.idx}`);
      else window.openOrderModalForItem(`folder:${it.fIdx}:${it.tIdx}`);
    });
    rightActions.appendChild(orderBtn);
    row.appendChild(left);
    row.appendChild(rightActions);
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--line)'; row.style.transform = 'translateX(4px)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'var(--card)'; row.style.transform = 'translateX(0)'; });
    list.appendChild(row);
  });

  card.appendChild(list);
  right.appendChild(card);
}

async function saveFolders() {
  try {
    localStorage.setItem('inventoryFolders', JSON.stringify(inventoryFolders));

    let shopId = null;
    try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch (e) {}

    if (shopId) {
      const { upsertFolderToSupabase } = await import('./helpers/inventory-api.js');

      for (const folder of inventoryFolders) {
        try { await upsertFolderToSupabase(folder, shopId); } catch (e) { console.warn('Folder sync failed for', folder.name, e); }
      }

      console.log('✅ Folders synced to Supabase');
    }
  } catch (e) {
    console.warn('Could not save folders', e);
  }
}

// Capitalize helper for display
function capitalize(s) {
  if (!s) return '';
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderFolders() {
  if (!inventoryGrid) return;
  // render each folder as a card at the start
  inventoryFolders.forEach((folder, fIdx) => {
    const card = document.createElement('div');
    card.className = 'inventory-card card folder-card';
    // Apply special blue styling for coolant folder (meta.blueBorder)
    if (folder.meta && folder.meta.blueBorder) {
      card.style.border = '2px solid #60a5fa';
      card.style.boxShadow = '0 2px 12px rgba(96,165,250,0.08)';
      card.style.background = 'linear-gradient(180deg,#f0f9ff,#ffffff)';
    }
    const unitLabel = (folder.unit === 'bottles') ? 'Bottles' : ((folder.unit === 'jugs') ? 'Jugs' : (folder.unit || 'each'));
    // If this is a jugs (5qt) or bottles (1qt) folder, show a friendly green "In Stock" label instead
    const unitDisplayHtml = (folder.unit === 'jugs' || folder.unit === 'bottles') ? `<span style="color:#10b981;font-weight:700">In Stock</span>` : escapeHtml(unitLabel);
    // Count types running low (<7)
    const lowTypes = (folder.items || []).filter(it => (parseInt(it.qty,10) || 0) < 7).length;
    const lowBadge = lowTypes ? `<span style="color:#dc2626;font-weight:700">(${lowTypes} Item${lowTypes>1?'s':''} running low)</span>` : '';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer">
        <div style="flex:1">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(folder.name)}</div>
          <div style="color:var(--muted);font-size:13px">Types: ${folder.items ? folder.items.length : 0} — Unit: ${unitDisplayHtml} ${lowBadge}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <button class="btn" data-open-folder="${fIdx}" aria-label="Open Folder">Open</button>
        </div>
      </div>
    `;

    const openBtn = card.querySelector('[data-open-folder]');
    if (openBtn) openBtn.addEventListener('click', () => openFolderModal(fIdx));
    // Folder removal is disabled: users may edit types but cannot remove preset folders

    inventoryGrid.appendChild(card);
    // If blueBorder meta present, tint folder buttons to blue as well
    if (folder.meta && folder.meta.blueBorder) {
      const btns = card.querySelectorAll('.btn');
      btns.forEach(b => {
        if (b.classList && b.classList.contains('danger')) return; // keep danger buttons red
        b.style.background = '#60a5fa';
        b.style.color = '#fff';
        b.style.border = 'none';
      });
    }
  });
}

function ensureDefaultFolders() {
  // Ensure there are two blank Oil folders: 1 Quart (Bottles) and 5 Quarts (Jugs), and a Coolant folder (Jugs, blue border)
  const target1 = 'oil - 1 quart';
  const target5 = 'oil - 5 quarts';
  const targetCoolant = 'coolant';
  let changed = false;

  // Remove any legacy generic 'Oil' folder (name 'oil' or id 'oil')
  const beforeCount = inventoryFolders.length;
  inventoryFolders = inventoryFolders.filter(f => {
    const n = (f.name || '').trim().toLowerCase();
    const id = (f.id || '').toString().toLowerCase();
    return !(n === 'oil' || id === 'oil');
  });
  if (inventoryFolders.length !== beforeCount) changed = true;

  // Ensure 1 Quart folder exists and is blank (display as Bottles)
  let f1 = inventoryFolders.find(f => (f.name || '').trim().toLowerCase() === target1);
  if (!f1) {
    inventoryFolders.unshift({ id: 'oil_1qt', name: 'Oil - 1 Quart', unit: 'bottles', items: [] });
    changed = true;
  } else {
    if (f1.unit !== 'bottles') { f1.unit = 'bottles'; changed = true; }
    if (!Array.isArray(f1.items)) { f1.items = []; changed = true; }
  }

  // Ensure 5 Quarts folder exists and is blank (display as Jugs)
  let f5 = inventoryFolders.find(f => (f.name || '').trim().toLowerCase() === target5);
  if (!f5) {
    inventoryFolders.unshift({ id: 'oil_5qt', name: 'Oil - 5 Quarts', unit: 'jugs', items: [] });
    changed = true;
  } else {
    if (f5.unit !== 'jugs') { f5.unit = 'jugs'; changed = true; }
    if (!Array.isArray(f5.items)) { f5.items = []; changed = true; }
  }

  // Ensure Coolant folder exists (display as Jugs, blue border, after oil folders)
  let coolantIdx = inventoryFolders.findIndex(f => (f.name || '').trim().toLowerCase() === targetCoolant);
  if (coolantIdx === -1) {
    // Insert after oil folders (which are at the start)
    let insertIdx = 0;
    if (f1) insertIdx++;
    if (f5) insertIdx++;
    inventoryFolders.splice(insertIdx, 0, { id: 'coolant', name: 'Coolant', unit: 'jugs', items: [], meta: { blueBorder: true } });
    changed = true;
  } else {
    // Ensure correct unit and meta
    let coolant = inventoryFolders[coolantIdx];
    if (coolant.unit !== 'jugs') { coolant.unit = 'jugs'; changed = true; }
    if (!Array.isArray(coolant.items)) { coolant.items = []; changed = true; }
    if (!coolant.meta || !coolant.meta.blueBorder) { coolant.meta = { ...(coolant.meta || {}), blueBorder: true }; changed = true; }
  }

  // Ensure Brake Fluid and Oil Filters folders exist (insert after Coolant)
  const targetBrake = 'brake fluid';
  const targetFilters = 'oil filters';
  // determine base insert index: after coolant if present, else after oil folders
  let baseInsert = inventoryFolders.findIndex(f => (f.name || '').trim().toLowerCase() === targetCoolant);
  if (baseInsert === -1) {
    baseInsert = 0;
    if (f1) baseInsert++;
    if (f5) baseInsert++;
  } else {
    baseInsert = baseInsert + 1; // insert after coolant
  }

  // Brake Fluid (bottles)
  let brakeIdx = inventoryFolders.findIndex(f => (f.name || '').trim().toLowerCase() === targetBrake);
  if (brakeIdx === -1) {
    inventoryFolders.splice(baseInsert, 0, { id: 'brake_fluid', name: 'Brake Fluid', unit: 'bottles', items: [] });
    changed = true;
    baseInsert++;
  } else {
    const brake = inventoryFolders[brakeIdx];
    if (brake.unit !== 'bottles') { brake.unit = 'bottles'; changed = true; }
    if (!Array.isArray(brake.items)) { brake.items = []; changed = true; }
  }

  // Oil Filters (each)
  let filtersIdx = inventoryFolders.findIndex(f => (f.name || '').trim().toLowerCase() === targetFilters);
  if (filtersIdx === -1) {
    inventoryFolders.splice(baseInsert, 0, { id: 'oil_filters', name: 'Oil Filters', unit: 'each', items: [] });
    changed = true;
  } else {
    const filters = inventoryFolders[filtersIdx];
    if (filters.unit !== 'each') { filters.unit = 'each'; changed = true; }
    if (!Array.isArray(filters.items)) { filters.items = []; changed = true; }
  }

  if (changed) saveFolders();
}

function openFolderModal(folderIdx) {
  const folderModal = document.getElementById('folderModal');
  const folderModalTitle = document.getElementById('folderModalTitle');
  const folderList = document.getElementById('folderList');
  const folderTypeName = document.getElementById('folderTypeName');
  const folderTypeNameCustom = document.getElementById('folderTypeNameCustom');
  const folderTypeQty = document.getElementById('folderTypeQty');
  const folderTypeForm = document.getElementById('folderTypeForm');
  const folderModalClose = document.getElementById('folderModalClose');

  if (!folderModal || !folderList) return;
  const folder = inventoryFolders[folderIdx];
  if (!folder) return;
  folderModalTitle.textContent = folder.name;
  // Ensure folder list container is visible and scrollable
  try {
    if (folderList) {
      folderList.style.display = 'block';
      folderList.style.maxHeight = '300px';
      folderList.style.overflowY = 'auto';
    }
  } catch (e) {}
  // Context-aware type options per folder
  const typeLabelEl = document.querySelector('label[for="folderTypeName"]');
  const defaultOptions = ['Euro','American','Asian','Custom'];
  const brakeOptions = ['Dot 3','Dot 4','Dot 5','Custom'];
  const oilOptions = ['0W-20','0W-30','5W-20','5W-30','5W-40','10W-30','10W-40','15W-40','Custom'];
  let optionsToUse = defaultOptions;
  const fname = (folder.name || '').trim().toLowerCase();
  if (fname === 'brake fluid') {
    optionsToUse = brakeOptions;
    if (typeLabelEl) typeLabelEl.textContent = 'Type (Dot 3, Dot 4, Dot 5)';
  } else if (fname === 'oil filters') {
    // Oil Filters: ask for vehicle or part number
    optionsToUse = defaultOptions;
    if (typeLabelEl) typeLabelEl.textContent = 'Vehicle(s) or Part number';
  } else if (fname.startsWith('oil')) {
    // oil folders (Oil - 1 Quart, Oil - 5 Quarts, etc.)
    optionsToUse = oilOptions;
    if (typeLabelEl) typeLabelEl.textContent = 'Viscosity (e.g. 5W-30)';
  } else if (fname === 'coolant') {
    optionsToUse = defaultOptions;
    if (typeLabelEl) typeLabelEl.textContent = 'Type (Euro, American, etc)';
  } else {
    if (typeLabelEl) typeLabelEl.textContent = 'Type (Euro, American, etc)';
  }
  // Populate the select with the appropriate options for this modal instance
  if (folderTypeName) {
    // clear previous options and add new ones
    folderTypeName.innerHTML = '';
    optionsToUse.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      folderTypeName.appendChild(opt);
    });
  }
  // If this is the Oil Filters folder, replace the select with vehicle/part inputs
  if (fname === 'oil filters') {
    const parentDiv = folderTypeName ? folderTypeName.parentNode : null;
    if (parentDiv) {
      // hide existing select/custom
      if (folderTypeName) folderTypeName.style.display = 'none';
      if (folderTypeNameCustom) folderTypeNameCustom.style.display = 'none';
      // create Vehicle(s) input
      if (!document.getElementById('folderFilterVehicle')) {
        const vehicleInput = document.createElement('input');
        vehicleInput.id = 'folderFilterVehicle';
        vehicleInput.name = 'folderFilterVehicle';
        vehicleInput.type = 'text';
        vehicleInput.placeholder = 'Vehicle(s) this filter fits (comma-separated)';
        vehicleInput.style = 'width:100%;padding:8px;margin-top:8px';
        parentDiv.appendChild(vehicleInput);
      }
      // create Part Number input
      if (!document.getElementById('folderFilterPart')) {
        const partInput = document.createElement('input');
        partInput.id = 'folderFilterPart';
        partInput.name = 'folderFilterPart';
        partInput.type = 'text';
        partInput.placeholder = 'Part number (optional)';
        partInput.style = 'width:100%;padding:8px;margin-top:8px';
        parentDiv.appendChild(partInput);
      }
    }
  } else {
    // ensure any leftover oil filter inputs are removed
    const vf = document.getElementById('folderFilterVehicle'); if (vf && vf.parentNode) vf.parentNode.removeChild(vf);
    const pf = document.getElementById('folderFilterPart'); if (pf && pf.parentNode) pf.parentNode.removeChild(pf);
    if (folderTypeName) folderTypeName.style.display = '';
  }
  // initialize select/custom input state
  if (folderTypeNameCustom) folderTypeNameCustom.style.display = 'none';
  if (folderTypeName && !folderTypeName.value) folderTypeName.value = folderTypeName.options && folderTypeName.options.length ? folderTypeName.options[0].value : '';

  function renderFolderItems() {
    folderList.innerHTML = '';
    try { console.log('renderFolderItems for', folder.name, 'items=', (folder.items||[]).length); } catch(e){}
    // expose this render function so outside handlers (folderOrderConfirm) can refresh
    currentFolderRender = renderFolderItems;
    (folder.items || []).forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'card';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
        const unitLabel = capitalize((folder.unit === 'bottles') ? 'Bottles' : ((folder.unit === 'jugs') ? 'Jugs' : (folder.unit || 'each')));
      // For jugs (5qt) or bottles (1qt) show friendly green "In Stock" label instead of the unit word
      const unitRowHtml = (folder.unit === 'jugs' || folder.unit === 'bottles')
        ? `<div style="color:#10b981;font-size:13px">In Stock: <strong style="color:#065f46">${it.qty || 0}</strong></div>`
        : `<div style="color:var(--muted);font-size:13px">${unitLabel}: <strong>${it.qty || 0}</strong></div>`;
      row.innerHTML = `
        <div>
          <div style="font-weight:700">${escapeHtml(it.name)}</div>
          ${unitRowHtml}
          ${it.sell_price ? `<div style="color:#10b981;font-size:12px;margin-top:6px">Price: $${parseFloat(it.sell_price).toFixed(2)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <div style="display:flex;gap:8px;">
            <button class="btn" data-order-type="${idx}">Order</button>
            <button class="btn" data-edit-type="${idx}" aria-label="Edit">Edit</button>
          </div>
          <div>
            <button class="btn danger" data-delete-type="${idx}" aria-label="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      const orderBtn = row.querySelector('[data-order-type]');
      if (orderBtn) orderBtn.addEventListener('click', () => {
        // Open themed modal for ordering folder-type item
        _folderOrderCurrent = { fIdx: folderIdx, tIdx: idx };
        // Debug logging to help trace why modal may not appear
        try { console.log('folderOrder click', { folderIdx, tIdx: idx, folderOrderModalPresent: !!folderOrderModal, folderOrderTitlePresent: !!folderOrderTitle, folderOrderQtyPresent: !!folderOrderQty }); } catch(e){}
        if (folderOrderTitle) folderOrderTitle.textContent = `Order ${it.name}`;
        if (folderOrderQty) folderOrderQty.value = '1';
          if (folderOrderModal) {
            try { folderOrderModal.style.paddingTop = '120px'; } catch(e){}
            folderOrderModal.classList.remove('hidden'); folderOrderModal.setAttribute('aria-hidden','false');
          } else {
          // Fallback so user sees something and we get quick feedback
          try { alert('Order dialog could not be opened — modal element not found (debug)'); } catch(e){}
        }
      });

      const editTypeBtn = row.querySelector('[data-edit-type]');
      if (editTypeBtn) editTypeBtn.addEventListener('click', () => {
        // Populate the folderType form to allow editing this type
        currentFolderEditIndex = idx;
        if (folderTypeName && fname !== 'oil filters') {
          // If the existing name matches one of the select options, choose it. Otherwise use Custom and show the custom input.
          const opts = Array.from(folderTypeName.options).map(o => o.value);
          if (opts.includes(it.name)) {
            folderTypeName.value = it.name;
            if (folderTypeNameCustom) { folderTypeNameCustom.style.display = 'none'; folderTypeNameCustom.value = ''; }
          } else {
            folderTypeName.value = 'Custom';
            if (folderTypeNameCustom) { folderTypeNameCustom.style.display = 'block'; folderTypeNameCustom.value = it.name || ''; }
          }
        }
        // For Oil Filters, populate vehicle and part inputs
        if (fname === 'oil filters') {
          const vEl = document.getElementById('folderFilterVehicle');
          const pEl = document.getElementById('folderFilterPart');
          if (vEl) vEl.value = it.vehicles || '';
          if (pEl) pEl.value = it.partNumber || '';
        }
        if (folderTypeQty) folderTypeQty.value = (it.qty != null ? String(it.qty) : '0');
        // Populate pricing fields if present
        const fCost = document.getElementById('folderTypeCostPrice');
        const fSell = document.getElementById('folderTypeSellPrice');
        const fCalc = document.getElementById('folderTypePricingCalc');
        const fMarkup = document.getElementById('folderTypeMarkup');
        const fProfit = document.getElementById('folderTypeProfit');
        if (fCost) fCost.value = (it.cost_price != null ? String(it.cost_price) : '');
        if (fSell) fSell.value = (it.sell_price != null ? String(it.sell_price) : '');
        if (fCalc && fMarkup && fProfit) {
          const costVal = (fCost && fCost.value) ? parseFloat(fCost.value) : null;
          const sellVal = (fSell && fSell.value) ? parseFloat(fSell.value) : null;
          if (costVal != null && costVal > 0 && sellVal != null) {
            const profit = sellVal - costVal;
            const markup = Math.round(((sellVal - costVal) / costVal) * 100);
            fMarkup.textContent = isFinite(markup) ? `${markup}%` : '-';
            fProfit.textContent = isFinite(profit) ? `$${profit.toFixed(2)}` : '-';
            fCalc.style.display = '';
          } else {
            fCalc.style.display = 'none';
          }
        }
        // change submit button text to indicate edit mode (if present)
        const submitBtn = folderTypeForm.querySelector('button[type=submit]');
        if (submitBtn) submitBtn.textContent = 'Save';
      });

      const delTypeBtn = row.querySelector('[data-delete-type]');
      if (delTypeBtn) delTypeBtn.addEventListener('click', () => {
        (async () => {
          const ok = await confirmDialog(`Remove type "${it.name}" from folder "${folder.name}"?`);
          if (!ok) return;
          try {
            if (it.id) {
              const { deleteFolderItemRemote } = await import('./helpers/inventory-api.js');
              const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(it.id));
              if (isUUID) {
                const res = await deleteFolderItemRemote(it.id);
                if (!res) {
                  try { showNotification && showNotification('Failed to delete folder type from remote', 'error'); } catch (e) {}
                  return;
                }
              }
            }
            folder.items.splice(idx, 1);
            await saveFolders();
            renderFolderItems();
            renderInventory();
            try {
              if (typeof showNotification === 'function') showNotification(`Removed ${it.name} from ${folder.name}`, 'success');
              else if (typeof window.showConfirmationBanner === 'function') window.showConfirmationBanner(`Removed ${it.name} from ${folder.name}`);
            } catch (e) {}
          } catch (e) {
            console.warn('Failed to remove folder type', e);
            try { showNotification && showNotification('Failed to remove folder type', 'error'); } catch (e) {}
          }
        })();
      });

      folderList.appendChild(row);
    });
    // Keep a sensible max height and enable inner scrolling
    try {
      const children = Array.from(folderList.children || []);
      if (children.length > 0) {
        // allow the folder list to scroll but don't shrink below 120px
        folderList.style.maxHeight = folderList.style.maxHeight || '300px';
        folderList.style.overflowY = 'auto';
      } else {
        folderList.style.maxHeight = '';
        folderList.style.overflowY = '';
      }
    } catch (e) { /* ignore measurement errors */ }
  }

  renderFolderItems();

  // show/hide custom input when user selects Custom
  if (folderTypeName) {
    folderTypeName.addEventListener('change', () => {
      if (folderTypeName.value === 'Custom') {
        if (folderTypeNameCustom) folderTypeNameCustom.style.display = 'block';
      } else {
        if (folderTypeNameCustom) { folderTypeNameCustom.style.display = 'none'; folderTypeNameCustom.value = ''; }
      }
    });
  }

  // Pricing inputs for folder type form
  const folderTypeCostPrice = document.getElementById('folderTypeCostPrice');
  const folderTypeSellPrice = document.getElementById('folderTypeSellPrice');
  const folderTypePricingCalc = document.getElementById('folderTypePricingCalc');
  const folderTypeMarkup = document.getElementById('folderTypeMarkup');
  const folderTypeProfit = document.getElementById('folderTypeProfit');

  function updateFolderTypePricingDisplay() {
    try {
      const costVal = folderTypeCostPrice ? (folderTypeCostPrice.value || '') : '';
      const sellVal = folderTypeSellPrice ? (folderTypeSellPrice.value || '') : '';
      const cost = (costVal === '') ? null : parseFloat(costVal) || 0;
      const sell = (sellVal === '') ? null : parseFloat(sellVal) || 0;
      if (!folderTypePricingCalc || !folderTypeMarkup || !folderTypeProfit) return;
      if (cost != null && cost > 0 && sell != null) {
        const profit = sell - cost;
        const markup = Math.round(((sell - cost) / cost) * 100);
        folderTypeMarkup.textContent = isFinite(markup) ? `${markup}%` : '-';
        folderTypeProfit.textContent = isFinite(profit) ? `$${profit.toFixed(2)}` : '-';
        folderTypePricingCalc.style.display = '';
      } else {
        folderTypePricingCalc.style.display = 'none';
      }
    } catch (e) {}
  }
  try { if (folderTypeCostPrice) folderTypeCostPrice.addEventListener('input', updateFolderTypePricingDisplay); } catch(e) {}
  try { if (folderTypeSellPrice) folderTypeSellPrice.addEventListener('input', updateFolderTypePricingDisplay); } catch(e) {}

  folderTypeForm.onsubmit = function(e) {
    e.preventDefault();
    let name = '';
    if (folderTypeName) {
      if (folderTypeName.value === 'Custom' && folderTypeNameCustom) name = (folderTypeNameCustom.value || '').trim();
      else name = (folderTypeName.value || '').trim();
    }
    const qty = parseFloat(folderTypeQty.value) || 0;
    const costVal = folderTypeCostPrice ? (folderTypeCostPrice.value || '') : '';
    const sellVal = folderTypeSellPrice ? (folderTypeSellPrice.value || '') : '';
    const cost_price = (costVal === '') ? null : parseFloat(costVal) || 0;
    const sell_price = (sellVal === '') ? null : parseFloat(sellVal) || 0;
    const markup_percent = (cost_price && cost_price > 0 && sell_price != null) ? Math.round(((sell_price - cost_price) / cost_price) * 100) : null;
    if (!name) return;
    folder.items = folder.items || [];
    if (currentFolderEditIndex !== null && folder.items[currentFolderEditIndex]) {
      // Update existing type
      folder.items[currentFolderEditIndex].name = name;
      folder.items[currentFolderEditIndex].qty = qty;
      folder.items[currentFolderEditIndex].lastOrder = folder.items[currentFolderEditIndex].lastOrder || null;
      folder.items[currentFolderEditIndex].cost_price = cost_price;
      folder.items[currentFolderEditIndex].sell_price = sell_price;
      folder.items[currentFolderEditIndex].markup_percent = markup_percent;
      updateOutOfStockFlag(folder.items[currentFolderEditIndex]);
      currentFolderEditIndex = null;
      // restore submit button text
      const submitBtn = folderTypeForm.querySelector('button[type=submit]');
      if (submitBtn) submitBtn.textContent = 'Add Type';
    } else {
      // Add new type
      folder.items.push({ name, qty, lastOrder: null, cost_price: cost_price, sell_price: sell_price, markup_percent: markup_percent });
    }
    saveFolders();
    folderTypeForm.reset();
    renderFolderItems();
    renderInventory();
  };

  // adjust label and prompt wording based on folder unit
  const qtyLabel = document.querySelector('label[for="folderTypeQty"]');
  if (qtyLabel) {
    const unitLabel = (folder.unit === 'bottles') ? 'Bottles' : ((folder.unit === 'jugs') ? 'Jugs' : (folder.unit || 'each'));
    qtyLabel.textContent = unitLabel;
  }

  // Ensure modal sizing and scrolling for folder items (inline style to avoid CSS specificity issues)
  try {
    const modalContent = folderModal.querySelector('.modal-content');
    const modalBody = folderModal.querySelector('.modal-body');
    if (modalContent) {
      modalContent.style.width = 'min(760px, 92vw)';
      modalContent.style.maxHeight = '88vh';
    }
    if (modalBody) {
      modalBody.style.maxHeight = 'calc(88vh - 88px)';
      modalBody.style.overflowY = 'auto';
    }
  } catch(e){}
  folderModal.classList.remove('hidden'); folderModal.setAttribute('aria-hidden','false');
  folderModalClose.onclick = function(){
    folderModal.classList.add('hidden');
    folderModal.setAttribute('aria-hidden','true');
    currentFolderRender = null;
    // reset form and hide custom input
    try { folderTypeForm.reset(); } catch(e){}
    if (folderTypeNameCustom) folderTypeNameCustom.style.display = 'none';
  };
  // Clear edit state when closing the folder modal
  folderModalClose.addEventListener('click', () => { currentFolderEditIndex = null; const submitBtn = folderTypeForm.querySelector('button[type=submit]'); if (submitBtn) submitBtn.textContent = 'Add Type'; });
}

// Simple HTML escape to avoid injecting content
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c];
  });
}

function openModal() {
  if (!inventoryModal) return;
  // Do not force a top padding — let CSS center the modal
  try { inventoryModal.style.paddingTop = ''; } catch(e){}
  inventoryModal.classList.remove('hidden');
  inventoryModal.setAttribute('aria-hidden', 'false');
}
function closeModal() {
  if (!inventoryModal) return;
  inventoryModal.classList.add('hidden');
  inventoryModal.setAttribute('aria-hidden', 'true');
  inventoryForm.reset();
  editItemId.value = '';
}

function openEditModal(idx) {
  const item = inventory[idx];
  inventoryModalTitle.textContent = 'Edit Inventory Item';
  itemName.value = item.name;
  itemQty.value = item.qty;
  editItemId.value = idx;
  openModal();
}

// Note: event handlers attached in setupInventory()

// Modal close on overlay click
inventoryModal && (inventoryModal.onclick = function(e) {
  if (e.target === inventoryModal) closeModal();
});

// Public setup to initialize DOM refs and handlers
export async function setupInventory() {
  console.log('📦 Setting up Inventory...');
  
  // Fetch inventory and folders from Supabase
  try {
    let shopId = null;
    try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch (e) {}
    
    if (shopId) {
      const { fetchInventoryForShop } = await import('./helpers/inventory-api.js');
      const remote = await fetchInventoryForShop(shopId);
      
      if (remote) {
        console.log('📦 Fetched from Supabase:', remote);
        
        // Update inventory items
        if (Array.isArray(remote.items) && remote.items.length > 0) {
          inventory = remote.items.map(it => ({
            name: it.name,
            qty: it.qty,
            id: it.id,
            lastOrder: it.last_order || null,
            outOfStockDate: it.out_of_stock_date || null,
            meta: it.meta || null,
            cost_price: it.cost_price || null,
            sell_price: it.sell_price || null,
            markup_percent: it.markup_percent || null
          }));
          localStorage.setItem('inventory', JSON.stringify(inventory));
        }
        
        // Update folders and their items
        if (Array.isArray(remote.folders) && remote.folders.length > 0) {
          inventoryFolders = remote.folders.map(f => ({
            id: f.id,
            name: f.name,
            unit: f.unit,
            meta: f.meta || null,
            items: (f.items || []).map(i => ({
              id: i.id,
              name: i.name,
              qty: i.qty,
              lastOrder: i.last_order || null,
              outOfStockDate: i.out_of_stock_date || null,
              meta: i.meta || null,
              vehicles: i.vehicles || null,
              partNumber: i.part_number || null,
              cost_price: i.cost_price || null,
              sell_price: i.sell_price || null,
              markup_percent: i.markup_percent || null
            }))
          }));
          localStorage.setItem('inventoryFolders', JSON.stringify(inventoryFolders));
          console.log('✅ Synced folders from Supabase:', inventoryFolders);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to fetch inventory from Supabase:', e);
  }
  inventoryGrid = document.getElementById('inventoryGrid');
  inventoryEmpty = document.getElementById('inventoryEmpty');
  btnNewItem = document.getElementById('btnNewItem');
  inventoryModal = document.getElementById('inventoryModal');
  inventoryModalClose = document.getElementById('inventoryModalClose');
  inventoryForm = document.getElementById('inventoryForm');
  editItemId = document.getElementById('editItemId');
  itemName = document.getElementById('itemName');
  itemQty = document.getElementById('itemQty');
  inventoryModalTitle = document.getElementById('inventoryModalTitle');
  // New price fields in add/edit modal
  const itemCostPrice = document.getElementById('itemCostPrice');
  const itemSellPrice = document.getElementById('itemSellPrice');
  const inventoryModalPricingCalc = document.getElementById('inventoryModalPricingCalc');
  const inventoryModalMarkup = document.getElementById('inventoryModalMarkup');
  const inventoryModalProfit = document.getElementById('inventoryModalProfit');
  totalItems = document.getElementById('totalItems');
  lowStock = document.getElementById('lowStock');

  // Confirmation modal refs (used by confirmDialog)
  confirmModal = document.getElementById('confirmModal');
  confirmMessageEl = document.getElementById('confirmMessage');
  confirmYesBtn = document.getElementById('confirmYes');
  confirmNoBtn = document.getElementById('confirmNo');

  // Ensure preset folders like 'Oil' exist
  ensureDefaultFolders();

  // Provide a local fallback for `showNotification` to use the green jobs-style banner
  if (typeof window.showNotification !== 'function') {
    window.showNotification = function(message, type = 'success') {
      const el = document.getElementById('notification');
      if (!el) {
        // fallback to confirmation banner helper or alert
        if (typeof window.showConfirmationBanner === 'function') return window.showConfirmationBanner(message);
        try { alert(message); } catch (e) {}
        return;
      }
      try {
        el.textContent = message;
        el.className = 'notification';
        el.style.background = (type === 'error') ? '#ef4444' : '#10b981';
        el.classList.remove('hidden');
        setTimeout(() => { if (el) el.classList.add('hidden'); }, 3000);
      } catch (e) {
        try { alert(message); } catch (er) {}
      }
    };
  }
  
  // New order elements
  const inventorySearch = document.getElementById('inventorySearch');
  const btnNewOrder = document.getElementById('btnNewOrder');
  const orderModal = document.getElementById('orderModal');
  const orderModalClose = document.getElementById('orderModalClose');
  const orderForm = document.getElementById('orderForm');
  const orderItemSelect = document.getElementById('orderItemSelect');
  const orderQty = document.getElementById('orderQty');

  // Populate the order select with inventory and folder items
  function populateOrderSelect() {
    if (!orderItemSelect) return;
    orderItemSelect.innerHTML = '';
    try {
      // Inventory items first
      (inventory || []).forEach((it, idx) => {
        const opt = document.createElement('option');
        opt.value = `inventory:${idx}`;
        opt.textContent = `${it.name} — In Stock: ${it.qty || 0}`;
        orderItemSelect.appendChild(opt);
      });
      // Folder items next
      (inventoryFolders || []).forEach((f, fIdx) => {
        (f.items || []).forEach((t, tIdx) => {
          const opt = document.createElement('option');
          opt.value = `folder:${fIdx}:${tIdx}`;
          opt.textContent = `${f.name} — ${t.name} — In Stock: ${t.qty || 0}`;
          orderItemSelect.appendChild(opt);
        });
      });
    } catch (e) { console.warn('populateOrderSelect error', e); }
  }

  // search state
  window.inventorySearchValue = '';
  if (inventorySearch) {
    inventorySearch.addEventListener('input', (e) => {
      window.inventorySearchValue = e.target.value || '';
      renderInventory();
    });
  }

  function renderFolders() {
    if (!inventoryGrid) return;
    // render each folder as a card at the start
    inventoryFolders.forEach((folder, fIdx) => {
      const card = document.createElement('div');
      card.className = 'inventory-card card folder-card';
      // Add blue styling for coolant folder
      if (folder.meta && folder.meta.blueBorder) {
        card.style.border = '2px solid #38bdf8'; // Tailwind sky-400
        card.style.boxShadow = '0 2px 12px rgba(56,189,248,0.08)';
        card.style.background = 'linear-gradient(180deg,#f0f9ff,#ffffff)';
      }
      const unitLabel = (folder.unit === 'bottles') ? 'Bottles' : ((folder.unit === 'jugs') ? 'Jugs' : (folder.unit || 'each'));
      // If this is a jugs (5qt) or bottles (1qt) folder, show a friendly green "In Stock" label instead
      const unitDisplayHtml = (folder.unit === 'jugs' || folder.unit === 'bottles') ? `<span style="color:#10b981;font-weight:700">In Stock</span>` : escapeHtml(unitLabel);
      // Count types running low (<7)
      const lowTypes = (folder.items || []).filter(it => (parseInt(it.qty,10) || 0) < 7).length;
      const lowBadge = lowTypes ? `<span style="color:#dc2626;font-weight:700">(${lowTypes} Item${lowTypes>1?'s':''} running low)</span>` : '';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer">
            <div style="flex:1">
            <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(folder.name)}</div>
            <div style="color:var(--muted);font-size:13px">Types: ${folder.items ? folder.items.length : 0} — Unit: ${unitDisplayHtml} ${lowBadge}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <button class="btn" data-open-folder="${fIdx}" aria-label="Open Folder">Open</button>
          </div>
        </div>
      `;

      const openBtn = card.querySelector('[data-open-folder]');
      if (openBtn) openBtn.addEventListener('click', () => openFolderModal(fIdx));
      // Folder deletion is intentionally disabled; only individual types/items may be removed

      inventoryGrid.appendChild(card);
      // Tint folder buttons for coolant folders (preserve danger buttons)
      if (folder.meta && folder.meta.blueBorder) {
        const btns = card.querySelectorAll('.btn');
        btns.forEach(b => {
          if (b.classList && b.classList.contains('danger')) return;
          b.style.background = '#38bdf8';
          b.style.color = '#fff';
          b.style.border = 'none';
        });
      }
    });
  }


  if (btnNewOrder) btnNewOrder.addEventListener('click', () => {
    if (!orderModal) return;
    try { orderModal.style.paddingTop = '120px'; } catch(e){}
    populateOrderSelect();
    if (orderItemSelect) orderItemSelect.selectedIndex = 0;
    if (orderQty) orderQty.value = 1;
    orderModal.classList.remove('hidden');
    orderModal.setAttribute('aria-hidden', 'false');
  });
  // Allow other UI (item cards, out-of-stock panel) to open the Order modal for a specific item
  window.openOrderModalForItem = function(target) {
    try {
      if (!orderModal || !orderItemSelect) return;
      // Normalize numeric index to inventory:idx
      if (typeof target === 'number') target = `inventory:${target}`;
      // If target is like 'inventory:3' or 'folder:0:2' accept it
      populateOrderSelect();
      // Try to select the matching option
      let found = Array.from(orderItemSelect.options).findIndex(o => o.value === String(target));
      if (found === -1) {
        // If not found (stale), try to match by name fragment if target is numeric index
        if (String(target).startsWith('inventory:')) {
          const idx = parseInt(String(target).split(':')[1], 10);
          if (!Number.isNaN(idx) && inventory[idx]) {
            const name = inventory[idx].name;
            found = Array.from(orderItemSelect.options).findIndex(o => o.textContent && o.textContent.indexOf(name) === 0);
          }
        }
      }
      orderItemSelect.selectedIndex = found >= 0 ? found : 0;
      if (orderQty) orderQty.value = 1;
      orderModal.classList.remove('hidden'); orderModal.setAttribute('aria-hidden','false');
    } catch (e) { console.warn('openOrderModalForItem error', e); }
  };
  if (orderModalClose) orderModalClose.addEventListener('click', () => {
    if (!orderModal) return; orderModal.classList.add('hidden'); orderModal.setAttribute('aria-hidden', 'true');
  });
  if (orderForm) orderForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sel = orderItemSelect.value || '';
    const q = parseInt(orderQty.value, 10) || 1;
    if (!sel || q <= 0) return;
    try {
      if (sel.startsWith('inventory:')) {
        const idx = parseInt(sel.split(':')[1], 10);
        if (!Number.isFinite(idx) || !inventory[idx]) return;
        inventory[idx].qty = (parseInt(inventory[idx].qty, 10) || 0) + q;
        inventory[idx].lastOrder = new Date().toISOString();
        updateOutOfStockFlag(inventory[idx]);
        localStorage.setItem('inventory', JSON.stringify(inventory));
        renderInventory();
      } else if (sel.startsWith('folder:')) {
        const parts = sel.split(':');
        const fIdx = parseInt(parts[1], 10);
        const tIdx = parseInt(parts[2], 10);
        if (!Number.isFinite(fIdx) || !Number.isFinite(tIdx)) return;
        if (!inventoryFolders[fIdx] || !Array.isArray(inventoryFolders[fIdx].items) || !inventoryFolders[fIdx].items[tIdx]) return;
        const it = inventoryFolders[fIdx].items[tIdx];
        it.qty = (parseInt(it.qty, 10) || 0) + q;
        it.lastOrder = new Date().toISOString();
        updateOutOfStockFlag(it);
        saveFolders();
        // Refresh open folder modal if it's the same folder
        try { if (typeof currentFolderRender === 'function') currentFolderRender(); } catch(e) {}
        try { renderInventory(); } catch(e) {}
      }
    } catch (err) {
      console.warn('Order submit error', err);
    }
    // Show confirmation banner for order placed (use existing showNotification if present)
    try { if (typeof showNotification === 'function') showNotification('Order placed', 'success'); else if (typeof window.showConfirmationBanner === 'function') window.showConfirmationBanner('Order placed'); else alert('Order placed'); } catch(e) {}
    orderModal.classList.add('hidden'); orderModal.setAttribute('aria-hidden', 'true');
  });

  if (!inventoryForm) {
    console.warn('Inventory form not found; aborting setup');
    return;
  }

  // Pricing display helper for the add/edit modal
  function updateInventoryModalPricingDisplay() {
    const costVal = (document.getElementById('itemCostPrice') || {}).value || '';
    const sellVal = (document.getElementById('itemSellPrice') || {}).value || '';
    const cost = (costVal === '') ? null : parseFloat(costVal) || 0;
    const sell = (sellVal === '') ? null : parseFloat(sellVal) || 0;
    const calc = document.getElementById('inventoryModalPricingCalc');
    const markupEl = document.getElementById('inventoryModalMarkup');
    const profitEl = document.getElementById('inventoryModalProfit');
    if (!calc || !markupEl || !profitEl) return;
    if (cost != null && cost > 0 && sell != null) {
      const profit = sell - cost;
      const markup = Math.round(((sell - cost) / cost) * 100);
      markupEl.textContent = (isFinite(markup) ? `${markup}%` : '-');
      profitEl.textContent = (isFinite(profit) ? `$${profit.toFixed(2)}` : '-');
      calc.style.display = '';
    } else {
      calc.style.display = 'none';
    }
  }

  // Wire pricing inputs to update calculations live
  try {
    const _cost = document.getElementById('itemCostPrice');
    const _sell = document.getElementById('itemSellPrice');
    if (_cost) _cost.addEventListener('input', updateInventoryModalPricingDisplay);
    if (_sell) _sell.addEventListener('input', updateInventoryModalPricingDisplay);
  } catch (e) {}

  // Wire Add Item button to open the Add Inventory modal
  if (btnNewItem) {
    btnNewItem.addEventListener('click', () => {
      if (!inventoryModal) return;
      inventoryModalTitle.textContent = 'Add Inventory Item';
      try { inventoryForm.reset(); } catch (e) {}
      if (editItemId) editItemId.value = '';
      if (itemName) itemName.value = '';
      if (itemQty) itemQty.value = '';
      if (itemCostPrice) itemCostPrice.value = '';
      if (itemSellPrice) itemSellPrice.value = '';
      if (inventoryModalPricingCalc) inventoryModalPricingCalc.style.display = 'none';
      openModal();
    });
  }

  // Modal close button
  if (inventoryModalClose) inventoryModalClose.addEventListener('click', closeModal);
  // Close modal when clicking overlay background
  if (inventoryModal) {
    inventoryModal.onclick = function(e) { if (e.target === inventoryModal) closeModal(); };
  }

  // Folder order modal refs
  folderOrderModal = document.getElementById('folderOrderModal');
  folderOrderTitle = document.getElementById('folderOrderTitle');
  folderOrderQty = document.getElementById('folderOrderQty');
  folderOrderConfirm = document.getElementById('folderOrderConfirm');
  folderOrderCancel = document.getElementById('folderOrderCancel');
  folderOrderCloseBtn = document.getElementById('folderOrderClose');

  if (folderOrderCloseBtn) folderOrderCloseBtn.addEventListener('click', () => { if (folderOrderModal) { folderOrderModal.classList.add('hidden'); folderOrderModal.setAttribute('aria-hidden','true'); } });
  if (folderOrderCancel) folderOrderCancel.addEventListener('click', () => { if (folderOrderModal) { folderOrderModal.classList.add('hidden'); folderOrderModal.setAttribute('aria-hidden','true'); } });
  if (folderOrderConfirm) folderOrderConfirm.addEventListener('click', () => {
    try {
      const qty = parseFloat(folderTypeQty.value) || 0;
      folder.items = folder.items || [];
      if (fname === 'oil filters') {
        // For oil filters require at least one of vehicle(s) or part number
        const vehicleEl = document.getElementById('folderFilterVehicle');
        const partEl = document.getElementById('folderFilterPart');
        const vehicles = vehicleEl ? (vehicleEl.value || '').trim() : '';
        const partNumber = partEl ? (partEl.value || '').trim() : '';
        if (!vehicles && !partNumber) {
          try { alert('Please provide at least the Vehicle(s) or the Part number'); } catch(e){}
          return;
        }
        const name = partNumber || vehicles;
        const itemObj = { name, qty, vehicles: vehicles || null, partNumber: partNumber || null, lastOrder: null };
        if (currentFolderEditIndex !== null && folder.items[currentFolderEditIndex]) {
          folder.items[currentFolderEditIndex] = Object.assign(folder.items[currentFolderEditIndex], itemObj);
          updateOutOfStockFlag(folder.items[currentFolderEditIndex]);
          currentFolderEditIndex = null;
          const submitBtn = folderTypeForm.querySelector('button[type=submit]'); if (submitBtn) submitBtn.textContent = 'Add Type';
        } else {
          folder.items.push(itemObj);
        }
      } else {
        let name = '';
        if (folderTypeName) {
          if (folderTypeName.value === 'Custom' && folderTypeNameCustom) name = (folderTypeNameCustom.value || '').trim();
          else name = (folderTypeName.value || '').trim();
        }
        if (!name) return;
        if (currentFolderEditIndex !== null && folder.items[currentFolderEditIndex]) {
          // Update existing type
          folder.items[currentFolderEditIndex].name = name;
          folder.items[currentFolderEditIndex].qty = qty;
          folder.items[currentFolderEditIndex].lastOrder = folder.items[currentFolderEditIndex].lastOrder || null;
          updateOutOfStockFlag(folder.items[currentFolderEditIndex]);
          currentFolderEditIndex = null;
          const submitBtn = folderTypeForm.querySelector('button[type=submit]'); if (submitBtn) submitBtn.textContent = 'Add Type';
        } else {
          // Add new type
          folder.items.push({ name, qty, lastOrder: null });
        }
      }
    } catch (err) {
      console.warn('Folder order confirm error', err);
    }
  });

  inventoryForm.onsubmit = async function(e) {
    e.preventDefault();
    const name = itemName.value.trim();
    const qty = parseInt(itemQty.value, 10);
    if (!name || isNaN(qty) || qty < 0) return;
    const idx = editItemId.value;
    const isNew = (idx === '');
    // Get shop ID
    let shopId = null;
    try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch (e) {}
    if (!shopId) {
      alert('Shop ID not found. Please log in again.');
      return;
    }
    try {
      // Import inventory API
      const { upsertInventoryItemRemote } = await import('./helpers/inventory-api.js');
      // Read pricing inputs
      const costRaw = itemCostPrice ? (itemCostPrice.value || '') : '';
      const sellRaw = itemSellPrice ? (itemSellPrice.value || '') : '';
      const cost_price = (costRaw === '') ? null : parseFloat(costRaw) || 0;
      const sell_price = (sellRaw === '') ? null : parseFloat(sellRaw) || 0;
      const markup_percent = (cost_price && cost_price > 0 && sell_price != null) ? Math.round(((sell_price - cost_price) / cost_price) * 100) : null;

      // Prepare item data (include pricing)
      const itemData = {
        name,
        qty,
        cost_price: cost_price,
        sell_price: sell_price,
        markup_percent: markup_percent,
        outOfStockDate: (qty === 0) ? new Date().toISOString() : null,
        id: isNew ? null : (inventory[idx] && inventory[idx].id) || null
      };
      // Save to Supabase
      const result = await upsertInventoryItemRemote(itemData, shopId);
      if (result) {
        console.log('✅ Item saved to Supabase:', result);
        // Update local inventory with UUID and pricing from Supabase
        if (isNew) {
          const obj = { name, qty, id: result.id, cost_price: result.cost_price || itemData.cost_price || null, sell_price: result.sell_price || itemData.sell_price || null, markup_percent: result.markup_percent || itemData.markup_percent || null };
          updateOutOfStockFlag(obj);
          inventory.push(obj);
        } else {
          inventory[idx] = Object.assign(inventory[idx] || {}, { name, qty, id: result.id, cost_price: result.cost_price || itemData.cost_price || null, sell_price: result.sell_price || itemData.sell_price || null, markup_percent: result.markup_percent || itemData.markup_percent || null });
          updateOutOfStockFlag(inventory[idx]);
        }
        localStorage.setItem('inventory', JSON.stringify(inventory));
        renderInventory();
        closeModal();
        try { 
          if (isNew && typeof showNotification === 'function') {
            showNotification('Inventory item added', 'success'); 
          } else if (isNew && typeof window.showConfirmationBanner === 'function') {
            window.showConfirmationBanner('Inventory item added'); 
          } else if (isNew) {
            alert('Inventory item added'); 
          }
        } catch(e) {}
      } else {
        throw new Error('Failed to save to Supabase');
      }
    } catch (error) {
      console.error('Failed to save inventory item:', error);
      alert('Failed to save to database: ' + error.message);
    }
  };

  // Initial render
  renderInventory();
  
  // Note: setupInventoryPricing is called when the pricing modal opens, not here
}

export default null;
