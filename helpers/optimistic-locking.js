/**
 * helpers/optimistic-locking.js
 * Prevent race conditions with optimistic locking
 */

import { getSupabaseClient } from './supabase.js';

/**
 * Update a record with optimistic locking
 */
async function updateWithLocking(table, id, currentVersion, updates, maxRetries = 3) {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    return { success: false, error: 'Supabase not available' };
  }
  
  let attempt = 0;
  
  while (attempt < maxRetries) {
    attempt++;
    
    try {
      console.log(`🔒 [LOCKING] Attempt ${attempt}/${maxRetries} - Updating ${table} id:${id} version:${currentVersion}`);
      
      const { data, error } = await supabase
        .from(table)
        .update({
          ...updates,
          version: currentVersion + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('version', currentVersion)
        .select();
      
      if (error) {
        console.error(`❌ [LOCKING] Update failed:`, error);
        return { success: false, error: error.message };
      }
      
      if (!data || data.length === 0) {
        console.warn(`⚠️ [LOCKING] Version conflict detected on attempt ${attempt}`);
        
        if (attempt >= maxRetries) {
          console.error(`❌ [LOCKING] Max retries reached for ${table} id:${id}`);
          return { 
            success: false, 
            conflict: true,
            error: 'This record was modified by another user. Please refresh and try again.' 
          };
        }
        
        const { data: latestData, error: fetchError } = await supabase
          .from(table)
          .select('*')
          .eq('id', id)
          .single();
        
        if (fetchError || !latestData) {
          console.error(`❌ [LOCKING] Failed to fetch latest version:`, fetchError);
          return { success: false, error: 'Failed to fetch latest record version' };
        }
        
        currentVersion = latestData.version;
        console.log(`🔄 [LOCKING] Retrying with version ${currentVersion}...`);
        
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        continue;
      }
      
      console.log(`✅ [LOCKING] Successfully updated ${table} id:${id} to version ${currentVersion + 1}`);
      return { success: true, data: data[0] };
      
    } catch (ex) {
      console.error(`❌ [LOCKING] Exception during update:`, ex);
      return { success: false, error: ex.message || 'Unknown error during update' };
    }
  }
  
  return { 
    success: false, 
    conflict: true,
    error: 'Max retries exceeded' 
  };
}

/**
 * Delete a record with optimistic locking
 */
async function deleteWithLocking(table, id, currentVersion) {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    return { success: false, error: 'Supabase not available' };
  }
  
  try {
    console.log(`🗑️ [LOCKING] Deleting ${table} id:${id} version:${currentVersion}`);
    
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('version', currentVersion)
      .select();
    
    if (error) {
      console.error(`❌ [LOCKING] Delete failed:`, error);
      return { success: false, error: error.message };
    }
    
    if (!data || data.length === 0) {
      console.warn(`⚠️ [LOCKING] Delete conflict - record version changed`);
      return { 
        success: false, 
        conflict: true,
        error: 'This record was modified by another user. Please refresh and try again.' 
      };
    }
    
    console.log(`✅ [LOCKING] Successfully deleted ${table} id:${id}`);
    return { success: true };
    
  } catch (ex) {
    console.error(`❌ [LOCKING] Exception during delete:`, ex);
    return { success: false, error: ex.message || 'Unknown error during delete' };
  }
}

/**
 * Create a new record with initial version = 1
 */
async function createWithLocking(table, record) {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    return { success: false, error: 'Supabase not available' };
  }
  
  try {
    console.log(`➕ [LOCKING] Creating new ${table} record with version 1`);
    
    const recordWithVersion = {
      ...record,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from(table)
      .insert([recordWithVersion])
      .select()
      .single();
    
    if (error) {
      console.error(`❌ [LOCKING] Create failed:`, error);
      return { success: false, error: error.message };
    }
    
    console.log(`✅ [LOCKING] Created ${table} with id:${data.id} version:1`);
    return { success: true, data };
    
  } catch (ex) {
    console.error(`❌ [LOCKING] Exception during create:`, ex);
    return { success: false, error: ex.message || 'Unknown error during create' };
  }
}

/**
 * Show a user-friendly conflict modal
 */
function showConflictModal(entityName = 'record') {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  `;
  
  modalContent.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
    <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 12px; color: #222;">Update Conflict</h2>
    <p style="color: #666; margin-bottom: 24px;">This ${entityName} was modified by another user. Please refresh the page to see the latest changes.</p>
    <button onclick="location.reload()" style="
      background: #2a7cff;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 32px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(42,124,255,0.3);
    ">Refresh Page</button>
  `;
  
  modal.appendChild(modalContent);
  document.body.appendChild(modal);
}

export { 
  updateWithLocking, 
  deleteWithLocking, 
  createWithLocking,
  showConflictModal 
};
