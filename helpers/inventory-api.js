import { getSupabaseClient } from './supabase.js';

/**
 * UPDATED Inventory API helper - now with automatic deduction support
 * When parts are added to jobs with inventory linkage, inventory is automatically deducted
 * 
 * Tables:
 * - inventory_items (id, shop_id, name, qty, last_order, out_of_stock_date, meta, cost_price, sell_price, markup_percent)
 * - inventory_folders (id, shop_id, name, unit)
 * - inventory_folder_items (id, folder_id, name, qty, last_order, out_of_stock_date, meta, cost_price, sell_price, markup_percent)
 * - job_parts (with inventory linkage: inventory_item_id, inventory_folder_item_id, auto_deducted)
 * - inventory_transactions (audit trail)
 */

export async function fetchInventoryForShop(shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return null;
    const [{ data: items, error: itemsErr }, { data: folders, error: foldersErr }, { data: folderItems, error: folderItemsErr }] = await Promise.all([
      supabase.from('inventory_items').select('*').eq('shop_id', shopId),
      supabase.from('inventory_folders').select('*').eq('shop_id', shopId),
      supabase.from('inventory_folder_items').select('*').eq('shop_id', shopId)
    ]);
    if (itemsErr || foldersErr || folderItemsErr) {
      console.warn('inventory-api: fetch errors', { itemsErr, foldersErr, folderItemsErr });
    }
    const folderMap = (folders || []).map(f => ({ 
      id: f.id,
      shop_id: f.shop_id,
      name: f.name,
      unit: f.unit,
      meta: f.meta || null,
      items: [] 
    }));
    (folderItems || []).forEach(fi => {
      const f = folderMap.find(x => String(x.id) === String(fi.folder_id) || x.id === fi.folder_id);
      if (f) f.items.push(fi);
    });
    return { items: items || [], folders: folderMap };
  } catch (e) {
    console.warn('inventory-api fetchInventoryForShop error', e);
    return null;
  }
}

/**
 * Add inventory item to job with automatic deduction
 * This is now the PRIMARY way to add inventory to jobs
 */
export async function addInventoryToJob(jobId, inventoryItemId, quantity, shopId, partDetails = {}) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobId || !inventoryItemId) {
      throw new Error('Missing required parameters');
    }
    
    console.log('📦 Adding inventory to job:', { jobId, inventoryItemId, quantity });

    // Quick de-duplication guard: if the same job/item/qty was added very recently,
    // skip to avoid double-inserts caused by duplicate UI events.
    try {
      if (typeof window !== 'undefined') {
        window._recentInventoryAdds = window._recentInventoryAdds || {};
        const key = `${jobId}|${inventoryItemId}|${quantity}`;
        const now = Date.now();
        const last = window._recentInventoryAdds[key] || 0;
        if (last && (now - last) < 3000) {
          console.warn('⚠️ Skipping duplicate addInventoryToJob call (debounce)', key);
          return null;
        }
        window._recentInventoryAdds[key] = now;
        // clear the marker after a short delay
        setTimeout(() => { try { delete window._recentInventoryAdds[key]; } catch (e) {} }, 5000);
      }
    } catch (e) { console.warn('Could not apply dedupe guard', e); }
    
    // Get inventory item details for validation and pricing
    const { data: invItem, error: invError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', inventoryItemId)
      .eq('shop_id', shopId)
      .single();
    
    if (invError) throw invError;
    
    // Check if enough inventory available
    if (invItem.qty < quantity) {
      throw new Error(`Insufficient inventory: ${invItem.name} (available: ${invItem.qty}, requested: ${quantity})`);
    }
    
    // SERVER-SIDE IDEMPOTENCY: check for a very recent identical job_part to avoid double-inserts
    try {
      const threshold = new Date(Date.now() - 5000).toISOString();
      const { data: existingParts } = await supabase
        .from('job_parts')
        .select('id')
        .eq('job_id', jobId)
        .eq('inventory_item_id', inventoryItemId)
        .eq('quantity', quantity)
        .gt('created_at', threshold)
        .limit(1);
      if (existingParts && existingParts.length) {
        console.warn('⚠️ Detected recent identical job_part insert - skipping duplicate insert', existingParts[0].id);
        return existingParts[0];
      }
    } catch (e) {
      console.warn('Idempotency check failed, proceeding with insert', e);
    }

    // Create job_parts record - trigger will auto-deduct inventory
    const payload = {
      shop_id: shopId,
      job_id: jobId,
      inventory_item_id: inventoryItemId,
      part_name: partDetails.part_name || invItem.name,
      part_number: partDetails.part_number || null,
      quantity: quantity || 1,
      cost_price: partDetails.cost_price || invItem.cost_price || 0,
      sell_price: partDetails.sell_price || invItem.sell_price || 0,
      markup_percent: partDetails.markup_percent || invItem.markup_percent || 0,
      auto_deducted: false // Trigger will set this to true after deduction
    };
    
    const { data, error } = await supabase
      .from('job_parts')
      .insert(payload)
      .select()
      .single();
    
    if (error) {
      // Check if it's an inventory shortage error
      if (error.message && error.message.includes('Insufficient inventory')) {
        throw new Error(error.message);
      }
      throw error;
    }
    
    console.log('✅ Inventory added to job and auto-deducted:', data);
    
    // Dispatch event for UI updates
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inventoryChanged', { 
        detail: { 
          jobId, 
          inventoryItemId, 
          quantity,
          action: 'deduct'
        } 
      }));
    }
    
    return data;
  } catch (e) {
    console.error('❌ addInventoryToJob error:', e);
    throw e;
  }
}

/**
 * Add folder inventory item to job with automatic deduction
 */
export async function addFolderInventoryToJob(jobId, folderItemId, quantity, shopId, partDetails = {}) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobId || !folderItemId) {
      throw new Error('Missing required parameters');
    }
    
    console.log('📦 Adding folder inventory to job:', { jobId, folderItemId, quantity });
    // Quick de-duplication guard similar to addInventoryToJob
    try {
      if (typeof window !== 'undefined') {
        window._recentInventoryAdds = window._recentInventoryAdds || {};
        const key = `${jobId}|folder|${folderItemId}|${quantity}`;
        const now = Date.now();
        const last = window._recentInventoryAdds[key] || 0;
        if (last && (now - last) < 3000) {
          console.warn('⚠️ Skipping duplicate addFolderInventoryToJob call (debounce)', key);
          return null;
        }
        window._recentInventoryAdds[key] = now;
        setTimeout(() => { try { delete window._recentInventoryAdds[key]; } catch (e) {} }, 5000);
      }
    } catch (e) { console.warn('Could not apply dedupe guard', e); }
    
    // Get folder item details
    const { data: folderItem, error: folderError } = await supabase
      .from('inventory_folder_items')
      .select('*')
      .eq('id', folderItemId)
      .eq('shop_id', shopId)
      .single();
    
    if (folderError) throw folderError;
    
    // Check if enough inventory available
    if (folderItem.qty < quantity) {
      throw new Error(`Insufficient inventory: ${folderItem.name} (available: ${folderItem.qty}, requested: ${quantity})`);
    }
    
    // SERVER-SIDE IDEMPOTENCY: check for a very recent identical job_part to avoid double-inserts
    try {
      const threshold = new Date(Date.now() - 5000).toISOString();
      const { data: existingParts } = await supabase
        .from('job_parts')
        .select('id')
        .eq('job_id', jobId)
        .eq('inventory_folder_item_id', folderItemId)
        .eq('quantity', quantity)
        .gt('created_at', threshold)
        .limit(1);
      if (existingParts && existingParts.length) {
        console.warn('⚠️ Detected recent identical job_part insert (folder) - skipping duplicate insert', existingParts[0].id);
        return existingParts[0];
      }
    } catch (e) {
      console.warn('Idempotency check failed (folder), proceeding with insert', e);
    }

    // Create job_parts record - trigger will auto-deduct
    const payload = {
      shop_id: shopId,
      job_id: jobId,
      inventory_folder_item_id: folderItemId,
      part_name: partDetails.part_name || folderItem.name,
      part_number: partDetails.part_number || null,
      quantity: quantity || 1,
      cost_price: partDetails.cost_price || folderItem.cost_price || 0,
      sell_price: partDetails.sell_price || folderItem.sell_price || 0,
      markup_percent: partDetails.markup_percent || folderItem.markup_percent || 0,
      auto_deducted: false
    };
    
    const { data, error } = await supabase
      .from('job_parts')
      .insert(payload)
      .select()
      .single();
    
    if (error) {
      if (error.message && error.message.includes('Insufficient inventory')) {
        throw new Error(error.message);
      }
      throw error;
    }
    
    console.log('✅ Folder inventory added to job and auto-deducted:', data);
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inventoryChanged', { 
        detail: { 
          jobId, 
          folderItemId, 
          quantity,
          action: 'deduct'
        } 
      }));
    }
    
    return data;
  } catch (e) {
    console.error('❌ addFolderInventoryToJob error:', e);
    throw e;
  }
}

/**
 * Remove part from job - automatically returns inventory
 */
export async function removeJobPart(jobPartId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobPartId) {
      throw new Error('Missing job part ID');
    }
    
    console.log('🗑️ Removing job part:', jobPartId);
    
    // Get job part details before deletion
    const { data: jobPart, error: fetchError } = await supabase
      .from('job_parts')
      .select('*')
      .eq('id', jobPartId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Delete job part - trigger will auto-return inventory
    const { error: deleteError } = await supabase
      .from('job_parts')
      .delete()
      .eq('id', jobPartId);
    
    if (deleteError) throw deleteError;
    
    console.log('✅ Job part removed and inventory returned');
    
    // Dispatch event for UI updates
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inventoryChanged', { 
        detail: { 
          jobId: jobPart.job_id, 
          inventoryItemId: jobPart.inventory_item_id || jobPart.inventory_folder_item_id, 
          quantity: jobPart.quantity,
          action: 'return'
        } 
      }));
    }
    
    return { success: true };
  } catch (e) {
    console.error('❌ removeJobPart error:', e);
    throw e;
  }
}

/**
 * Get all job parts for a job (with inventory linkage info)
 */
export async function getJobParts(jobId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobId) return [];
    
    const { data, error } = await supabase
      .from('job_parts')
      .select(`
        *,
        inventory_item:inventory_items(id, name, qty),
        inventory_folder_item:inventory_folder_items(id, name, qty)
      `)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('getJobParts error', e);
    return [];
  }
}

/**
 * Get low stock items for a shop
 */
export async function getLowStockItems(shopId, threshold = 5) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return [];
    
    const { data, error } = await supabase
      .rpc('get_low_stock_items', { 
        p_shop_id: shopId, 
        p_threshold: threshold 
      });
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('getLowStockItems error', e);
    return [];
  }
}

/**
 * Get inventory usage report for date range
 */
export async function getInventoryUsage(shopId, startDate, endDate) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return [];
    
    const { data, error } = await supabase
      .rpc('get_inventory_usage', {
        p_shop_id: shopId,
        p_start_date: startDate,
        p_end_date: endDate
      });
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('getInventoryUsage error', e);
    return [];
  }
}

/**
 * Get inventory transactions for audit trail
 */
export async function getInventoryTransactions(shopId, filters = {}) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return [];
    
    let query = supabase
      .from('inventory_transactions')
      .select(`
        *,
        inventory_item:inventory_items(name),
        inventory_folder_item:inventory_folder_items(name),
        job:jobs(id)
      `)
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });
    
    if (filters.itemId) {
      query = query.eq('inventory_item_id', filters.itemId);
    }
    if (filters.folderItemId) {
      query = query.eq('inventory_folder_item_id', filters.folderItemId);
    }
    if (filters.jobId) {
      query = query.eq('job_id', filters.jobId);
    }
    if (filters.transactionType) {
      query = query.eq('transaction_type', filters.transactionType);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('getInventoryTransactions error', e);
    return [];
  }
}

/**
 * Manually adjust inventory (for restocking, corrections, etc.)
 */
export async function adjustInventoryQuantity(itemId, newQuantity, shopId, notes = '', isFolder = false) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId || !shopId) {
      throw new Error('Missing required parameters');
    }
    
    const table = isFolder ? 'inventory_folder_items' : 'inventory_items';
    
    // Get current quantity
    const { data: currentItem, error: fetchError } = await supabase
      .from(table)
      .select('qty, name')
      .eq('id', itemId)
      .single();
    
    if (fetchError) throw fetchError;
    
    const quantityBefore = currentItem.qty || 0;
    const quantityChange = newQuantity - quantityBefore;
    
    // Update quantity
    const { data, error } = await supabase
      .from(table)
      .update({ 
        qty: newQuantity,
        out_of_stock_date: newQuantity === 0 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select()
      .single();
    
    if (error) throw error;
    
    // Log transaction
    const transactionPayload = {
      shop_id: shopId,
      transaction_type: 'adjustment',
      quantity: Math.abs(quantityChange),
      quantity_before: quantityBefore,
      quantity_after: newQuantity,
      notes: notes || `Manual adjustment: ${quantityBefore} → ${newQuantity}`
    };
    
    if (isFolder) {
      transactionPayload.inventory_folder_item_id = itemId;
    } else {
      transactionPayload.inventory_item_id = itemId;
    }
    
    await supabase.from('inventory_transactions').insert(transactionPayload);
    
    console.log('✅ Inventory adjusted:', currentItem.name, quantityBefore, '→', newQuantity);
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inventoryChanged', { 
        detail: { 
          itemId, 
          quantityBefore,
          quantityAfter: newQuantity,
          action: 'adjustment'
        } 
      }));
    }
    
    return data;
  } catch (e) {
    console.error('❌ adjustInventoryQuantity error:', e);
    throw e;
  }
}

// LEGACY FUNCTIONS - DEPRECATED but kept for backward compatibility
// These manually deduct but DON'T create job_parts records
// Use addInventoryToJob() instead

export async function decrementInventoryItemRemote(itemId, qty = 1, shopId) {
  console.warn('⚠️ decrementInventoryItemRemote is deprecated. Use addInventoryToJob instead.');
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId) return null;
    
    const cur = await supabase.from('inventory_items').select('qty, name').eq('id', itemId).single();
    if (cur.error) return null;
    
    const next = Math.max(0, (parseInt(cur.data.qty, 10) || 0) - qty);
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ 
        qty: next, 
        out_of_stock_date: next === 0 ? new Date().toISOString() : null 
      })
      .eq('id', itemId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  } catch (e) { 
    console.warn('decrementInventoryItemRemote', e); 
    return null; 
  }
}

export async function decrementFolderItemRemote(folderItemId, qty = 1, shopId) {
  console.warn('⚠️ decrementFolderItemRemote is deprecated. Use addFolderInventoryToJob instead.');
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !folderItemId) return null;
    
    const cur = await supabase.from('inventory_folder_items').select('qty, name').eq('id', folderItemId).single();
    if (cur.error) return null;
    
    const next = Math.max(0, (parseInt(cur.data.qty, 10) || 0) - qty);
    const { data, error } = await supabase
      .from('inventory_folder_items')
      .update({ 
        qty: next, 
        out_of_stock_date: next === 0 ? new Date().toISOString() : null 
      })
      .eq('id', folderItemId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  } catch (e) { 
    console.warn('decrementFolderItemRemote', e); 
    return null; 
  }
}

// Keep existing upsert and delete functions unchanged

export async function upsertInventoryItemRemote(item, shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error('❌ upsertInventoryItemRemote: Supabase client not available');
      return null;
    }
    
    console.log('📝 upsertInventoryItemRemote: Attempting to save', { item, shopId });
    
    const payload = { 
      shop_id: shopId, 
      name: item.name || '', 
      qty: item.qty || 0, 
      last_order: item.lastOrder || null, 
      out_of_stock_date: item.outOfStockDate || null, 
      meta: item.meta || null,
      cost_price: item.cost_price || null,
      sell_price: item.sell_price || null,
      markup_percent: item.markup_percent || null
    };
    
    console.log('📦 upsertInventoryItemRemote: Payload', payload);
    
    if (item.id) {
      console.log('🔄 upsertInventoryItemRemote: Updating existing item', item.id);
      const { data, error } = await supabase.from('inventory_items').update(payload).eq('id', item.id).select().single();
      if (error) {
        console.error('❌ upsertInventoryItemRemote: Update error', error);
        throw error;
      }
      console.log('✅ upsertInventoryItemRemote: Update successful', data);
      return data;
    } else {
      console.log('➕ upsertInventoryItemRemote: Inserting new item');
      const { data, error } = await supabase.from('inventory_items').insert(payload).select().single();
      if (error) {
        console.error('❌ upsertInventoryItemRemote: Insert error', error);
        throw error;
      }
      console.log('✅ upsertInventoryItemRemote: Insert successful', data);
      return data;
    }
  } catch (e) { 
    console.error('❌ upsertInventoryItemRemote: Exception caught', e); 
    return null; 
  }
}

export async function upsertFolderItemRemote(folderId, item, shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    
    const payload = { 
      shop_id: shopId, 
      folder_id: folderId, 
      name: item.name || '', 
      qty: item.qty || 0, 
      last_order: item.lastOrder || null, 
      out_of_stock_date: item.outOfStockDate || null, 
      meta: item.meta || null, 
      cost_price: item.cost_price || null, 
      sell_price: item.sell_price || null, 
      markup_percent: item.markup_percent || null 
    };
    
    if (item.id) {
      const { data, error } = await supabase.from('inventory_folder_items').update(payload).eq('id', item.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase.from('inventory_folder_items').insert(payload).select().single();
      if (error) throw error;
      return data;
    }
  } catch (e) { 
    console.warn('upsertFolderItemRemote', e); 
    return null; 
  }
}

export async function upsertFolderToSupabase(folder, shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return null;
    
    console.log('📁 Syncing folder to Supabase:', folder.name);
    
    const folderPayload = {
      shop_id: shopId,
      name: folder.name,
      unit: folder.unit || null
    };
    
    let folderId = folder.id;
    const isValidUUID = folder.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(folder.id));
    
    if (isValidUUID) {
      const { data: folderData, error: folderError } = await supabase
        .from('inventory_folders')
        .update(folderPayload)
        .eq('id', folder.id)
        .select()
        .single();
      
      if (folderError) {
        const { data: insertData, error: insertError } = await supabase
          .from('inventory_folders')
          .insert(folderPayload)
          .select()
          .single();
        
        if (insertError) throw insertError;
        folderId = insertData.id;
        folder.id = folderId;
      } else {
        folderId = folderData.id;
      }
    } else {
      const { data: existingFolder } = await supabase
        .from('inventory_folders')
        .select('id')
        .eq('shop_id', shopId)
        .eq('name', folder.name)
        .maybeSingle();
      
      if (existingFolder) {
        const { data: folderData, error: folderError } = await supabase
          .from('inventory_folders')
          .update(folderPayload)
          .eq('id', existingFolder.id)
          .select()
          .single();
        
        if (folderError) throw folderError;
        folderId = folderData.id;
        folder.id = folderId;
      } else {
        const { data: folderData, error: folderError } = await supabase
          .from('inventory_folders')
          .insert(folderPayload)
          .select()
          .single();
        
        if (folderError) throw folderError;
        folderId = folderData.id;
        folder.id = folderId;
      }
    }
    
    if (folder.items && folder.items.length > 0) {
      for (const item of folder.items) {
        await upsertFolderItemRemote(folderId, item, shopId);
      }
    }
    
    console.log('✅ Folder synced:', folder.name);
    
    if (typeof window !== 'undefined' && window.inventoryFolders) {
      try {
        localStorage.setItem('inventoryFolders', JSON.stringify(window.inventoryFolders || []));
      } catch (e) {}
    }
    
    return folderId;
  } catch (e) {
    console.error('❌ Error syncing folder to Supabase:', e);
    return null;
  }
}

export async function deleteInventoryItemRemote(itemId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId) return false;
    
    const { data, error } = await supabase.from('inventory_items').delete().eq('id', itemId).select();
    if (error) {
      if (error.code === 'PGRST116') return true;
      console.warn('deleteInventoryItemRemote error', error);
      return false;
    }
    return Array.isArray(data) ? true : !!data;
  } catch (e) { 
    console.warn('deleteInventoryItemRemote', e); 
    return false; 
  }
}

export async function deleteFolderItemRemote(folderItemId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !folderItemId) return false;
    
    const { data, error } = await supabase.from('inventory_folder_items').delete().eq('id', folderItemId).select();
    if (error) {
      if (error.code === 'PGRST116') return true;
      console.warn('deleteFolderItemRemote error', error);
      return false;
    }
    return Array.isArray(data) ? true : !!data;
  } catch (e) { 
    console.warn('deleteFolderItemRemote', e); 
    return false; 
  }
}
