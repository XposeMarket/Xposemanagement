import { getSupabaseClient } from './supabase.js';

/**
 * Inventory API helper - wraps Supabase calls for inventory and folders.
 * Assumes the following tables exist:
 * - inventory_items (id, shop_id, name, qty, last_order, out_of_stock_date, meta)
 * - inventory_folders (id, shop_id, name, unit)
 * - inventory_folder_items (id, folder_id, name, qty, last_order, out_of_stock_date, meta)
 * - job_parts (with inventory linkage)
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
    // Assemble folders with their items (ensure meta is preserved)
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

export async function decrementInventoryItemRemote(itemId, qty = 1, shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId) return null;
    // Fallback: fetch current, then update
    const cur = await supabase.from('inventory_items').select('qty').eq('id', itemId).single();
    if (cur.error) return null;
    const next = Math.max(0, (parseInt(cur.data.qty, 10) || 0) - qty);
    const { data: d2, error: e2 } = await supabase.from('inventory_items').update({ qty: next, out_of_stock_date: next === 0 ? new Date().toISOString() : null }).eq('id', itemId).select().single();
    if (e2) throw e2;
    return d2;
  } catch (e) { console.warn('decrementInventoryItemRemote', e); return null; }
}

export async function decrementFolderItemRemote(folderItemId, qty = 1, shopId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !folderItemId) return null;
    const cur = await supabase.from('inventory_folder_items').select('qty').eq('id', folderItemId).single();
    if (cur.error) return null;
    const next = Math.max(0, (parseInt(cur.data.qty, 10) || 0) - qty);
    const { data, error } = await supabase.from('inventory_folder_items').update({ qty: next, out_of_stock_date: next === 0 ? new Date().toISOString() : null }).eq('id', folderItemId).select().single();
    if (error) throw error;
    return data;
  } catch (e) { console.warn('decrementFolderItemRemote', e); return null; }
}

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
    const payload = { shop_id: shopId, folder_id: folderId, name: item.name || '', qty: item.qty || 0, last_order: item.lastOrder || null, out_of_stock_date: item.outOfStockDate || null, meta: item.meta || null, cost_price: item.cost_price || null, sell_price: item.sell_price || null, markup_percent: item.markup_percent || null };
    if (item.id) {
      const { data, error } = await supabase.from('inventory_folder_items').update(payload).eq('id', item.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase.from('inventory_folder_items').insert(payload).select().single();
      if (error) throw error;
      return data;
    }
  } catch (e) { console.warn('upsertFolderItemRemote', e); return null; }
}

/**
 * Link inventory item to job part and auto-deduct
 * This creates a job_parts record with inventory linkage
 */
export async function addInventoryToJob(jobId, inventoryItemId, quantity, shopId, partDetails = {}) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobId || !inventoryItemId) return null;
    
    // Get inventory item details
    const { data: invItem, error: invError } = await supabase
      .from('inventory_items')
      .select('name')
      .eq('id', inventoryItemId)
      .single();
    
    if (invError) throw invError;
    
    // Create job_parts record (trigger will auto-deduct)
    const payload = {
      shop_id: shopId,
      job_id: jobId,
      inventory_item_id: inventoryItemId,
      part_name: partDetails.part_name || invItem.name,
      part_number: partDetails.part_number || null,
      quantity: quantity || 1,
      cost_price: partDetails.cost_price || 0,
      sell_price: partDetails.sell_price || 0,
      markup_percent: partDetails.markup_percent || 0
    };
    
    const { data, error } = await supabase
      .from('job_parts')
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('✅ Inventory added to job and auto-deducted:', data);
    return data;
  } catch (e) {
    console.warn('addInventoryToJob error', e);
    return null;
  }
}

/**
 * Link folder inventory item to job part and auto-deduct
 */
export async function addFolderInventoryToJob(jobId, folderItemId, quantity, shopId, partDetails = {}) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !jobId || !folderItemId) return null;
    
    // Get folder item details
    const { data: folderItem, error: folderError } = await supabase
      .from('inventory_folder_items')
      .select('name')
      .eq('id', folderItemId)
      .single();
    
    if (folderError) throw folderError;
    
    // Create job_parts record (trigger will auto-deduct)
    const payload = {
      shop_id: shopId,
      job_id: jobId,
      inventory_folder_item_id: folderItemId,
      part_name: partDetails.part_name || folderItem.name,
      part_number: partDetails.part_number || null,
      quantity: quantity || 1,
      cost_price: partDetails.cost_price || 0,
      sell_price: partDetails.sell_price || 0,
      markup_percent: partDetails.markup_percent || 0
    };
    
    const { data, error } = await supabase
      .from('job_parts')
      .insert(payload)
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('✅ Folder inventory added to job and auto-deducted:', data);
    return data;
  } catch (e) {
    console.warn('addFolderInventoryToJob error', e);
    return null;
  }
}

/**
 * Get low stock items for a shop
 */
export async function getLowStockItems(shopId, threshold = 3) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !shopId) return [];
    
    const { data, error } = await supabase
      .rpc('get_low_stock_items', { p_shop_id: shopId, p_threshold: threshold });
    
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
 * Upsert folder and its items to Supabase
 */
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
    
    // Check if ID is a valid UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const isValidUUID = folder.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(folder.id));
    
    if (isValidUUID) {
      // Has valid UUID, try to update existing
      console.log('🔄 Updating folder with UUID:', folder.id);
      const { data: folderData, error: folderError } = await supabase
        .from('inventory_folders')
        .update(folderPayload)
        .eq('id', folder.id)
        .select()
        .single();
      
      if (folderError) {
        // Might not exist, try insert instead
        console.log('⚠️ Update failed, trying insert');
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
      // No UUID or local ID like "oil_1qt", check if folder already exists by name
      console.log('➕ Inserting new folder (local ID:', folder.id, ')');
      
      // First check if a folder with this name already exists
      const { data: existingFolder, error: checkError } = await supabase
        .from('inventory_folders')
        .select('id')
        .eq('shop_id', shopId)
        .eq('name', folder.name)
        .maybeSingle();
      
      if (existingFolder) {
        // Folder exists, update it
        console.log('📝 Found existing folder, updating:', existingFolder.id);
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
        // Folder doesn't exist, insert new
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
    
    // Upsert folder items
    if (folder.items && folder.items.length > 0) {
      for (const item of folder.items) {
        const itemPayload = {
          shop_id: shopId,
          folder_id: folderId,
          name: item.name,
          qty: item.qty || 0,
          last_order: item.lastOrder || null,
          out_of_stock_date: item.outOfStockDate || null,
          meta: item.meta || null,
          cost_price: item.cost_price || null,
          sell_price: item.sell_price || null,
          markup_percent: item.markup_percent || null
        };
        
        const isValidItemUUID = item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item.id));
        
        if (isValidItemUUID) {
          // Update existing item
          const { data, error } = await supabase
            .from('inventory_folder_items')
            .update(itemPayload)
            .eq('id', item.id)
            .select()
            .single();
          
          if (error) {
            // Try insert if update fails
            const { data: insertData, error: insertError } = await supabase
              .from('inventory_folder_items')
              .insert(itemPayload)
              .select()
              .single();
            
            if (insertError) throw insertError;
            item.id = insertData.id;
          }
        } else {
          // Check if item exists by name in this folder
          const { data: existingItem } = await supabase
            .from('inventory_folder_items')
            .select('id')
            .eq('folder_id', folderId)
            .eq('name', item.name)
            .maybeSingle();
          
          if (existingItem) {
            // Update existing
            const { data, error } = await supabase
              .from('inventory_folder_items')
              .update(itemPayload)
              .eq('id', existingItem.id)
              .select()
              .single();
            
            if (error) throw error;
            item.id = existingItem.id;
          } else {
            // Insert new
            const { data, error } = await supabase
              .from('inventory_folder_items')
              .insert(itemPayload)
              .select()
              .single();
            
            if (error) throw error;
            item.id = data.id;
          }
        }
      }
    }
    
    console.log('✅ Folder synced:', folder.name);
    
    // Save updated folders with UUIDs back to localStorage
    try {
      localStorage.setItem('inventoryFolders', JSON.stringify(window.inventoryFolders || []));
    } catch (e) {}
    
    return folderId;
  } catch (e) {
    console.error('❌ Error syncing folder to Supabase:', e);
    return null;
  }
}

/**
 * Delete an inventory item by id
 */
export async function deleteInventoryItemRemote(itemId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId) return null;
    const { data, error } = await supabase.from('inventory_items').delete().eq('id', itemId).select().single();
    if (error) throw error;
    return data;
  } catch (e) { console.warn('deleteInventoryItemRemote', e); return null; }
}

/**
 * Delete a folder item by id
 */
export async function deleteFolderItemRemote(folderItemId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !folderItemId) return null;
    const { data, error } = await supabase.from('inventory_folder_items').delete().eq('id', folderItemId).select().single();
    if (error) throw error;
    return data;
  } catch (e) { console.warn('deleteFolderItemRemote', e); return null; }
}
