/**
 * pages/inventory.js
 * Inventory page - Manage inventory items
 * 
 * Imported by: app.js
 */

export function setupInventory() {
  console.log('📦 Setting up Inventory...');
  // Ensure DOM elements exist; when navigating back the page markup
  // may not yet be present. Retry a few times before aborting.
  window.inventorySetupAttempts = (window.inventorySetupAttempts || 0) + 1;
  if (!document.getElementById('inventoryGrid')) {
    if (window.inventorySetupAttempts <= 5) {
      setTimeout(setupInventory, 50);
      return;
    } else {
      console.warn('pages/inventory: DOM elements missing after retries');
      return; // abort to avoid accessing null DOM elements
    }
  }
  
  let inventory = JSON.parse(localStorage.getItem('inventory') || '[]');
  // Attempt to fetch remote inventory for this shop and replace local if available
  (async function tryFetchRemote() {
    try {
      let shopId = null;
      try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch (e) {}
      if (!shopId) return;
      const api = await import('../helpers/inventory-api.js');
      if (api && typeof api.fetchInventoryForShop === 'function') {
        const remote = await api.fetchInventoryForShop(shopId);
        if (remote) {
          if (Array.isArray(remote.items) && remote.items.length > 0) {
            inventory = remote.items.map(it => ({ name: it.name, qty: it.qty, id: it.id, lastOrder: it.last_order || null, outOfStockDate: it.out_of_stock_date || null, meta: it.meta || null }));
            localStorage.setItem('inventory', JSON.stringify(inventory));
          }
          if (Array.isArray(remote.folders) && remote.folders.length >= 0) {
            // Store folders under inventoryFolders key to keep compatibility
            const folders = remote.folders.map(f => ({ id: f.id, name: f.name, unit: f.unit, items: (f.items || []).map(i => ({ id: i.id, name: i.name, qty: i.qty, lastOrder: i.last_order || null, outOfStockDate: i.out_of_stock_date || null, meta: i.meta || null })) }));
            localStorage.setItem('inventoryFolders', JSON.stringify(folders));
            try { window.inventoryFolders = folders; } catch(e){}
          }
          try { window.inventory = inventory; } catch(e){}
          // Re-render after remote sync
          try { if (typeof renderInventory === 'function') renderInventory(); } catch(e){}
        }
      }
    } catch (e) {
      console.warn('pages/inventory: remote fetch failed', e);
    }
  })();

  const inventoryBody = document.getElementById('inventoryGrid');
  const inventoryEmpty = document.getElementById('inventoryEmpty');
  const btnNewItem = document.getElementById('btnNewItem');
  const inventoryModal = document.getElementById('inventoryModal');
  const inventoryModalClose = document.getElementById('inventoryModalClose');
  const inventoryForm = document.getElementById('inventoryForm');
  const editItemId = document.getElementById('editItemId');
  const itemName = document.getElementById('itemName');
  const itemQty = document.getElementById('itemQty');
  const inventoryModalTitle = document.getElementById('inventoryModalTitle');
  const totalItems = document.getElementById('totalItems');
  const lowStock = document.getElementById('lowStockItem');

  function renderInventory() {
    inventoryBody.innerHTML = '';
    if (!inventory.length) {
      inventoryEmpty.style.display = '';
      totalItems.textContent = '0';
      lowStock.textContent = '0';
      return;
    }
    inventoryEmpty.style.display = 'none';
    let low = 0;
    inventory.forEach((item, idx) => {
      if (item.qty <= 3) low++;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${item.qty}</td>
        <td>
          <button class="btn" data-edit="${idx}" aria-label="Edit">Edit</button>
        </td>
      `;
      tr.querySelector('[data-edit]').onclick = () => openEditModal(idx);
      inventoryBody.appendChild(tr);
    });
    totalItems.textContent = inventory.length;
    lowStock.textContent = low;
  }

  // Expose render hook for other modules to refresh inventory UI
  try { window.renderInventory = renderInventory; window.inventory = inventory; } catch (e) {}

  function openModal() {
    inventoryModal.classList.remove('hidden');
    inventoryModal.setAttribute('aria-hidden', 'false');
  }
  
  function closeModal() {
    inventoryModal.classList.add('hidden');
    inventoryModal.setAttribute('aria-hidden', 'true');
    inventoryForm.reset();
    editItemId.value = '';
  }

  btnNewItem.onclick = () => {
    inventoryModalTitle.textContent = 'Add Inventory Item';
    inventoryForm.reset();
    editItemId.value = '';
    openModal();
  };
  
  inventoryModalClose.onclick = closeModal;

  function openEditModal(idx) {
    const item = inventory[idx];
    inventoryModalTitle.textContent = 'Edit Inventory Item';
    itemName.value = item.name;
    itemQty.value = item.qty;
    editItemId.value = idx;
    openModal();
  }

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
    
    // Prepare item data
    const itemData = {
      name,
      qty,
      id: isNew ? null : (inventory[idx] && inventory[idx].id) || null
    };
    
    // Save to Supabase
    try {
      const api = await import('../helpers/inventory-api.js');
      const result = await api.upsertInventoryItemRemote(itemData, shopId);
      
      if (result) {
        console.log('✅ Item saved to Supabase:', result);
        
        // Update local inventory
        if (isNew) {
          inventory.push({ name, qty, id: result.id });
        } else {
          inventory[idx] = { name, qty, id: result.id };
        }
        localStorage.setItem('inventory', JSON.stringify(inventory));
        
        renderInventory();
        closeModal();
        
        // Show success notification
        try { 
          if (isNew && typeof showNotification === 'function') {
            showNotification('Inventory item added', 'success'); 
          } else if (isNew && typeof window.showConfirmationBanner === 'function') {
            window.showConfirmationBanner('Inventory item added'); 
          } else if (isNew) {
            alert('Inventory item added'); 
          }
        } catch (e) {}
      } else {
        throw new Error('Failed to save item');
      }
    } catch (error) {
      console.error('Failed to save inventory item:', error);
      alert('Failed to save inventory item to database. Check console for details.');
    }
  };

  // Modal close on overlay click
  inventoryModal.onclick = function(e) {
    if (e.target === inventoryModal) closeModal();
  };

  // Initial render
  renderInventory();
  
  console.log('✅ Inventory setup complete');
}
