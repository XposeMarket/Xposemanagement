/**
 * Invoice Inventory Handler
 * Handles inventory adjustments when invoice items are edited or deleted
 */

/**
 * Handle inventory adjustment when an invoice item is deleted
 * @param {Object} item - The invoice item being deleted
 * @param {string} jobId - The job ID associated with the invoice
 * @param {string} shopId - The shop ID
 * @returns {Promise<boolean>} - Success status
 */
export async function handleItemDeletion(item, jobId, shopId) {
  console.log('🗑️ Handling item deletion:', { item, jobId, shopId });
  
  if (!item || !jobId || !shopId) {
    console.warn('⚠️ Missing required parameters for item deletion');
    return false;
  }
  
  try {
    // Import required modules
    const { supabase } = await import('../helpers/supabase.js');
    const inventoryAPI = await import('../helpers/inventory-api.js');
    
    // Check if this item is linked to inventory
    const { data: jobParts, error: fetchError } = await supabase
      .from('job_parts')
      .select('*')
      .eq('job_id', jobId)
      .eq('part_name', item.name);
    
    if (fetchError) {
      console.error('❌ Error fetching job_parts:', fetchError);
      return false;
    }
    
    if (!jobParts || jobParts.length === 0) {
      console.log('ℹ️ No job_parts found for this item (probably manual/catalog part)');
      return true; // Not an error, just not inventory-linked
    }
    
    // Process each matching job_part (usually just one)
    for (const jobPart of jobParts) {
      console.log('📦 Found job_part:', jobPart);
      
      // Check if it has inventory_item_id or folder_inventory_item_id
      if (jobPart.inventory_item_id) {
        console.log('🔄 Removing regular inventory job_part:', jobPart.id);
        // Remove using the API (triggers auto-return)
        await inventoryAPI.removeJobPart(jobPart.id, shopId);
        console.log('✅ Inventory returned automatically via trigger');
        
      } else if (jobPart.folder_inventory_item_id) {
        console.log('🔄 Removing folder inventory job_part:', jobPart.id);
        // Remove using the API (triggers auto-return)
        await inventoryAPI.removeJobPart(jobPart.id, shopId);
        console.log('✅ Folder inventory returned automatically via trigger');
        
      } else {
        console.log('ℹ️ Job_part has no inventory link (manual/catalog part)');
        // Still delete the job_part record
        await supabase
          .from('job_parts')
          .delete()
          .eq('id', jobPart.id);
      }
    }
    
    // Refresh inventory UI
    if (typeof window.refreshInventoryUI === 'function') {
      await window.refreshInventoryUI(shopId);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Error handling item deletion:', error);
    return false;
  }
}

/**
 * Handle inventory adjustment when an invoice item quantity changes
 * @param {Object} oldItem - The original item with old quantity
 * @param {Object} newItem - The updated item with new quantity
 * @param {string} jobId - The job ID associated with the invoice
 * @param {string} shopId - The shop ID
 * @returns {Promise<boolean>} - Success status
 */
export async function handleQuantityChange(oldItem, newItem, jobId, shopId) {
  console.log('🔢 Handling quantity change:', { 
    old: oldItem, 
    new: newItem, 
    jobId, 
    shopId 
  });
  
  if (!oldItem || !newItem || !jobId || !shopId) {
    console.warn('⚠️ Missing required parameters for quantity change');
    return false;
  }
  
  const oldQty = parseInt(oldItem.qty) || 0;
  const newQty = parseInt(newItem.qty) || 0;
  const diff = newQty - oldQty;
  
  if (diff === 0) {
    console.log('ℹ️ No quantity change detected');
    return true;
  }
  
  console.log(`📊 Quantity change: ${oldQty} → ${newQty} (diff: ${diff > 0 ? '+' : ''}${diff})`);
  
  try {
    // Import required modules
    const { supabase } = await import('../helpers/supabase.js');
    const inventoryAPI = await import('../helpers/inventory-api.js');
    
    // Find the job_part record for this item
    const { data: jobParts, error: fetchError } = await supabase
      .from('job_parts')
      .select('*')
      .eq('job_id', jobId)
      .eq('part_name', newItem.name);
    
    if (fetchError) {
      console.error('❌ Error fetching job_parts:', fetchError);
      return false;
    }
    
    if (!jobParts || jobParts.length === 0) {
      console.log('ℹ️ No job_parts found (manual/catalog part)');
      return true;
    }
    
    const jobPart = jobParts[0];
    
    // Check if linked to inventory
    if (!jobPart.inventory_item_id && !jobPart.folder_inventory_item_id) {
      console.log('ℹ️ Not linked to inventory (manual/catalog part)');
      return true;
    }
    
    if (diff > 0) {
      // INCREASING quantity - need to DEDUCT more inventory
      console.log(`➕ Increasing by ${diff} - deducting more inventory`);
      
      if (jobPart.inventory_item_id) {
        // Regular inventory
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('qty')
          .eq('id', jobPart.inventory_item_id)
          .single();
        
        if (!invItem || invItem.qty < diff) {
          throw new Error(`Insufficient inventory. Available: ${invItem?.qty || 0}, Needed: ${diff}`);
        }
        
        // Update inventory quantity (deduct)
        await supabase
          .from('inventory_items')
          .update({ qty: invItem.qty - diff })
          .eq('id', jobPart.inventory_item_id);
        
        console.log(`✅ Deducted ${diff} from regular inventory`);
        
      } else if (jobPart.folder_inventory_item_id) {
        // Folder inventory
        const { data: folderItem } = await supabase
          .from('inventory_folder_items')
          .select('qty')
          .eq('id', jobPart.folder_inventory_item_id)
          .single();
        
        if (!folderItem || folderItem.qty < diff) {
          throw new Error(`Insufficient inventory. Available: ${folderItem?.qty || 0}, Needed: ${diff}`);
        }
        
        // Update folder inventory quantity (deduct)
        await supabase
          .from('inventory_folder_items')
          .update({ qty: folderItem.qty - diff })
          .eq('id', jobPart.folder_inventory_item_id);
        
        console.log(`✅ Deducted ${diff} from folder inventory`);
      }
      
      // Update job_part quantity
      await supabase
        .from('job_parts')
        .update({ quantity: newQty })
        .eq('id', jobPart.id);
      
    } else {
      // DECREASING quantity - need to RETURN inventory
      const returnQty = Math.abs(diff);
      console.log(`➖ Decreasing by ${returnQty} - returning inventory`);
      
      if (jobPart.inventory_item_id) {
        // Regular inventory - return stock
        await supabase.rpc('return_inventory_to_stock', {
          p_inventory_item_id: jobPart.inventory_item_id,
          p_quantity: returnQty,
          p_shop_id: shopId
        });
        
        console.log(`✅ Returned ${returnQty} to regular inventory`);
        
      } else if (jobPart.folder_inventory_item_id) {
        // Folder inventory - return stock
        await supabase.rpc('return_folder_inventory_to_stock', {
          p_folder_item_id: jobPart.folder_inventory_item_id,
          p_quantity: returnQty,
          p_shop_id: shopId
        });
        
        console.log(`✅ Returned ${returnQty} to folder inventory`);
      }
      
      // Update job_part quantity
      await supabase
        .from('job_parts')
        .update({ quantity: newQty })
        .eq('id', jobPart.id);
    }
    
    // Log the transaction
    const transactionType = diff > 0 ? 'quantity_increase' : 'quantity_decrease';
    await supabase
      .from('inventory_transactions')
      .insert({
        shop_id: shopId,
        inventory_item_id: jobPart.inventory_item_id || null,
        folder_inventory_item_id: jobPart.folder_inventory_item_id || null,
        job_id: jobId,
        transaction_type: transactionType,
        quantity: Math.abs(diff),
        notes: `Invoice edit: quantity changed from ${oldQty} to ${newQty}`
      });
    
    // Refresh inventory UI
    if (typeof window.refreshInventoryUI === 'function') {
      await window.refreshInventoryUI(shopId);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Error handling quantity change:', error);
    throw error; // Re-throw to show error to user
  }
}

/**
 * Setup inventory monitoring for invoice items
 * Call this when the invoice modal opens
 */
export function setupInvoiceInventoryMonitoring(invoiceItems, jobId, shopId) {
  console.log('🔍 Setting up inventory monitoring for invoice items');
  
  // Store original items for comparison
  window._originalInvoiceItems = JSON.parse(JSON.stringify(invoiceItems));
  window._currentJobId = jobId;
  window._currentShopId = shopId;
  
  console.log('✅ Monitoring active for', invoiceItems.length, 'items');
}

/**
 * Detect and handle all inventory changes when invoice is saved
 * @param {Array} newItems - The updated invoice items
 * @returns {Promise<boolean>} - Success status
 */
export async function handleInvoiceSave(newItems) {
  console.log('💾 Handling invoice save with inventory adjustments');
  
  const originalItems = window._originalInvoiceItems || [];
  const jobId = window._currentJobId;
  const shopId = window._currentShopId;
  
  if (!jobId || !shopId) {
    console.warn('⚠️ No job/shop context - skipping inventory adjustments');
    return true;
  }
  
  try {
    // Find deleted items
    const deletedItems = originalItems.filter(oldItem => 
      !newItems.some(newItem => newItem.name === oldItem.name)
    );
    
    // Find quantity changes
    const changedItems = originalItems.filter(oldItem => {
      const newItem = newItems.find(n => n.name === oldItem.name);
      return newItem && newItem.qty !== oldItem.qty;
    });
    
    console.log(`📋 Changes detected:`, {
      deleted: deletedItems.length,
      quantityChanged: changedItems.length
    });
    
    // Handle deletions
    for (const item of deletedItems) {
      await handleItemDeletion(item, jobId, shopId);
    }
    
    // Handle quantity changes
    for (const oldItem of changedItems) {
      const newItem = newItems.find(n => n.name === oldItem.name);
      if (newItem) {
        await handleQuantityChange(oldItem, newItem, jobId, shopId);
      }
    }
    
    console.log('✅ All inventory adjustments complete');
    return true;
    
  } catch (error) {
    console.error('❌ Error during invoice save inventory adjustments:', error);
    throw error;
  }
}
