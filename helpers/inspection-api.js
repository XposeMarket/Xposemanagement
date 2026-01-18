/**
 * helpers/inspection-api.js
 * Supabase CRUD operations for Digital Vehicle Inspections
 */

import { getSupabaseClient } from './supabase.js';
import { createInspectionFromTemplate, calculateCounts, calculateGrade } from './inspection-templates.js';

// =============================================
// GET CURRENT CONTEXT
// =============================================

function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

async function getCurrentAuthId() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch (e) {
    return null;
  }
}

async function getCurrentUserInfo() {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  const authId = await getCurrentAuthId();
  
  if (!supabase || !shopId || !authId) {
    return { authId, shopId, name: 'Unknown', role: 'staff' };
  }

  try {
    // Try shop_staff first
    const { data: staffData } = await supabase
      .from('shop_staff')
      .select('first_name, last_name, role')
      .eq('auth_id', authId)
      .eq('shop_id', shopId)
      .single();

    if (staffData) {
      return {
        authId,
        shopId,
        name: `${staffData.first_name || ''} ${staffData.last_name || ''}`.trim() || 'Staff',
        role: staffData.role || 'staff'
      };
    }

    // Try users table (for owners)
    const { data: userData } = await supabase
      .from('users')
      .select('first, last, role')
      .eq('id', authId)
      .single();

    if (userData) {
      return {
        authId,
        shopId,
        name: `${userData.first || ''} ${userData.last || ''}`.trim() || 'Owner',
        role: userData.role || 'admin'
      };
    }
  } catch (e) {
    console.warn('[inspection-api] Could not get user info:', e);
  }

  return { authId, shopId, name: 'Unknown', role: 'staff' };
}

// =============================================
// CREATE INSPECTION
// =============================================

/**
 * Create a new inspection for an appointment/job
 * @param {object} params 
 * @param {string} params.appointmentId - Required
 * @param {string} params.jobId - Optional
 * @param {string} params.templateId - Template to use (default: standard_dvi)
 * @param {string} params.vehicleId - Optional
 * @param {string} params.customerId - Optional
 * @returns {Promise<object|null>}
 */
export async function createInspection({ appointmentId, jobId = null, templateId = 'standard_dvi', vehicleId = null, customerId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('[inspection-api] No Supabase client');
    return null;
  }

  const userInfo = await getCurrentUserInfo();
  if (!userInfo.shopId || !userInfo.authId) {
    console.error('[inspection-api] Missing shop or auth ID');
    return null;
  }

  try {
    // Create sections from template
    const sections = createInspectionFromTemplate(templateId);
    const counts = calculateCounts(sections);
    const grade = calculateGrade(counts, false);

    const inspectionData = {
      shop_id: userInfo.shopId,
      appointment_id: appointmentId,
      job_id: jobId,
      vehicle_id: vehicleId,
      customer_id: customerId,
      template_id: templateId,
      template_name: templateId === 'standard_dvi' ? 'Standard DVI' : 
                     templateId === 'quick_check' ? 'Quick Check' : 
                     templateId === 'pre_purchase' ? 'Pre-Purchase' : templateId,
      created_by: userInfo.authId,
      inspector_name: userInfo.name,
      status: 'draft',
      grade,
      unsafe_to_drive: false,
      fail_count: counts.failCount,
      attention_count: counts.attentionCount,
      pass_count: counts.passCount,
      high_priority_count: counts.highPriorityCount,
      sections,
      notes: ''
    };

    const { data, error } = await supabase
      .from('inspections')
      .insert(inspectionData)
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error creating inspection:', error);
      return null;
    }

    console.log('✅ Inspection created:', data.id);
    return data;
  } catch (e) {
    console.error('[inspection-api] Exception creating inspection:', e);
    return null;
  }
}

// =============================================
// GET INSPECTION(S)
// =============================================

/**
 * Get inspection by ID
 * @param {string} inspectionId 
 * @returns {Promise<object|null>}
 */
export async function getInspectionById(inspectionId) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();

    if (error) {
      console.error('[inspection-api] Error fetching inspection:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('[inspection-api] Exception fetching inspection:', e);
    return null;
  }
}

/**
 * Get inspection by share token (for customer viewing)
 * @param {string} shareToken 
 * @returns {Promise<object|null>}
 */
export async function getInspectionByShareToken(shareToken) {
  const supabase = getSupabaseClient();
  if (!supabase || !shareToken) return null;

  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('share_token', shareToken)
      .single();

    if (error) {
      console.error('[inspection-api] Error fetching inspection by token:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('[inspection-api] Exception fetching inspection by token:', e);
    return null;
  }
}

/**
 * Get inspection for an appointment
 * @param {string} appointmentId 
 * @returns {Promise<object|null>}
 */
export async function getInspectionByAppointmentId(appointmentId) {
  const supabase = getSupabaseClient();
  if (!supabase || !appointmentId) return null;

  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[inspection-api] Error fetching inspection:', error);
    }

    return data || null;
  } catch (e) {
    console.error('[inspection-api] Exception fetching inspection:', e);
    return null;
  }
}

/**
 * Get inspection for a job
 * @param {string} jobId 
 * @returns {Promise<object|null>}
 */
export async function getInspectionByJobId(jobId) {
  const supabase = getSupabaseClient();
  if (!supabase || !jobId) return null;

  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[inspection-api] Error fetching inspection:', error);
    }

    return data || null;
  } catch (e) {
    console.error('[inspection-api] Exception fetching inspection:', e);
    return null;
  }
}

/**
 * Get all inspections for current shop
 * @param {object} filters - Optional filters
 * @returns {Promise<Array>}
 */
export async function getShopInspections(filters = {}) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  if (!supabase || !shopId) return [];

  try {
    let query = supabase
      .from('inspections')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.grade) {
      query = query.eq('grade', filters.grade);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[inspection-api] Error fetching inspections:', error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error('[inspection-api] Exception fetching inspections:', e);
    return [];
  }
}

// =============================================
// UPDATE INSPECTION
// =============================================

/**
 * Update inspection sections (and recalculate counts/grade)
 * @param {string} inspectionId 
 * @param {Array} sections 
 * @param {boolean} unsafeToDrive 
 * @returns {Promise<object|null>}
 */
export async function updateInspectionSections(inspectionId, sections, unsafeToDrive = false) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    const counts = calculateCounts(sections);
    const grade = calculateGrade(counts, unsafeToDrive);

    const { data, error } = await supabase
      .from('inspections')
      .update({
        sections,
        unsafe_to_drive: unsafeToDrive,
        fail_count: counts.failCount,
        attention_count: counts.attentionCount,
        pass_count: counts.passCount,
        high_priority_count: counts.highPriorityCount,
        grade,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error updating inspection:', error);
      return null;
    }

    console.log('✅ Inspection updated:', data.id);
    return data;
  } catch (e) {
    console.error('[inspection-api] Exception updating inspection:', e);
    return null;
  }
}

/**
 * Update a single item in an inspection
 * @param {string} inspectionId 
 * @param {number} sectionIndex 
 * @param {number} itemIndex 
 * @param {object} itemUpdates - { status, priority, notes, mediaIds }
 * @returns {Promise<object|null>}
 */
export async function updateInspectionItem(inspectionId, sectionIndex, itemIndex, itemUpdates) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    // Fetch current inspection
    const { data: inspection, error: fetchError } = await supabase
      .from('inspections')
      .select('sections, unsafe_to_drive')
      .eq('id', inspectionId)
      .single();

    if (fetchError || !inspection) {
      console.error('[inspection-api] Error fetching inspection for update:', fetchError);
      return null;
    }

    // Update the specific item
    const sections = [...inspection.sections];
    if (sections[sectionIndex] && sections[sectionIndex].items[itemIndex]) {
      sections[sectionIndex].items[itemIndex] = {
        ...sections[sectionIndex].items[itemIndex],
        ...itemUpdates
      };
    } else {
      console.error('[inspection-api] Invalid section/item index');
      return null;
    }

    // Save back
    return await updateInspectionSections(inspectionId, sections, inspection.unsafe_to_drive);
  } catch (e) {
    console.error('[inspection-api] Exception updating item:', e);
    return null;
  }
}

/**
 * Update inspection status
 * @param {string} inspectionId 
 * @param {string} status - draft, in_progress, ready_for_review, sent_to_customer, customer_responded, closed
 * @returns {Promise<object|null>}
 */
export async function updateInspectionStatus(inspectionId, status) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    // Set timestamps based on status
    if (status === 'sent_to_customer') {
      updateData.sent_at = new Date().toISOString();
    } else if (status === 'closed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('inspections')
      .update(updateData)
      .eq('id', inspectionId)
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error updating status:', error);
      return null;
    }

    console.log('✅ Inspection status updated:', status);
    return data;
  } catch (e) {
    console.error('[inspection-api] Exception updating status:', e);
    return null;
  }
}

/**
 * Update inspection notes
 * @param {string} inspectionId 
 * @param {string} notes 
 * @returns {Promise<object|null>}
 */
export async function updateInspectionNotes(inspectionId, notes) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error updating notes:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('[inspection-api] Exception updating notes:', e);
    return null;
  }
}

/**
 * Mark inspection as unsafe to drive
 * @param {string} inspectionId 
 * @param {boolean} unsafe 
 * @returns {Promise<object|null>}
 */
export async function setUnsafeToDrive(inspectionId, unsafe) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return null;

  try {
    // Fetch current sections to recalculate grade
    const { data: inspection, error: fetchError } = await supabase
      .from('inspections')
      .select('sections')
      .eq('id', inspectionId)
      .single();

    if (fetchError || !inspection) return null;

    return await updateInspectionSections(inspectionId, inspection.sections, unsafe);
  } catch (e) {
    console.error('[inspection-api] Exception setting unsafe flag:', e);
    return null;
  }
}

// =============================================
// DELETE INSPECTION
// =============================================

/**
 * Delete an inspection
 * @param {string} inspectionId 
 * @returns {Promise<boolean>}
 */
export async function deleteInspection(inspectionId) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return false;

  try {
    // Delete associated media first
    const { error: mediaError } = await supabase
      .from('inspection_media')
      .delete()
      .eq('inspection_id', inspectionId);

    if (mediaError) {
      console.warn('[inspection-api] Error deleting inspection media:', mediaError);
    }

    // Delete recommendations
    const { error: recError } = await supabase
      .from('inspection_recommendations')
      .delete()
      .eq('inspection_id', inspectionId);

    if (recError) {
      console.warn('[inspection-api] Error deleting recommendations:', recError);
    }

    // Delete inspection
    const { error } = await supabase
      .from('inspections')
      .delete()
      .eq('id', inspectionId);

    if (error) {
      console.error('[inspection-api] Error deleting inspection:', error);
      return false;
    }

    console.log('✅ Inspection deleted:', inspectionId);
    return true;
  } catch (e) {
    console.error('[inspection-api] Exception deleting inspection:', e);
    return false;
  }
}

// =============================================
// MEDIA UPLOAD
// =============================================

/**
 * Upload media for an inspection item
 * @param {string} inspectionId 
 * @param {number} sectionIndex 
 * @param {number} itemIndex 
 * @param {File} file 
 * @returns {Promise<object|null>} - { id, url, type }
 */
export async function uploadInspectionMedia(inspectionId, sectionIndex, itemIndex, file) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  const authId = await getCurrentAuthId();

  if (!supabase || !shopId || !authId || !inspectionId || !file) {
    console.error('[inspection-api] Missing required params for media upload');
    return null;
  }

  try {
    // Upload to storage
    const fileExt = file.name.split('.').pop().toLowerCase();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const filePath = `${shopId}/${inspectionId}/${sectionIndex}_${itemIndex}_${timestamp}_${random}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('inspection-media')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });

    if (uploadError) {
      console.error('[inspection-api] Media upload error:', uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('inspection-media')
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      console.error('[inspection-api] Could not get public URL');
      return null;
    }

    // Save to inspection_media table
    const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
    const { data: mediaRecord, error: insertError } = await supabase
      .from('inspection_media')
      .insert({
        inspection_id: inspectionId,
        section_index: sectionIndex,
        item_index: itemIndex,
        media_url: urlData.publicUrl,
        media_type: mediaType,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: authId
      })
      .select()
      .single();

    if (insertError) {
      console.error('[inspection-api] Error saving media record:', insertError);
      return null;
    }

    console.log('✅ Media uploaded:', mediaRecord.id);
    return {
      id: mediaRecord.id,
      url: urlData.publicUrl,
      type: mediaType,
      name: file.name
    };
  } catch (e) {
    console.error('[inspection-api] Exception uploading media:', e);
    return null;
  }
}

/**
 * Get all media for an inspection
 * @param {string} inspectionId 
 * @returns {Promise<Array>}
 */
export async function getInspectionMedia(inspectionId) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return [];

  try {
    const { data, error } = await supabase
      .from('inspection_media')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[inspection-api] Error fetching media:', error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error('[inspection-api] Exception fetching media:', e);
    return [];
  }
}

/**
 * Delete inspection media
 * @param {string} mediaId 
 * @returns {Promise<boolean>}
 */
export async function deleteInspectionMedia(mediaId) {
  const supabase = getSupabaseClient();
  if (!supabase || !mediaId) return false;

  try {
    // Get the media record first to get the file path
    const { data: media, error: fetchError } = await supabase
      .from('inspection_media')
      .select('media_url')
      .eq('id', mediaId)
      .single();

    if (fetchError || !media) return false;

    // Delete from storage (extract path from URL)
    try {
      const url = new URL(media.media_url);
      const pathMatch = url.pathname.match(/\/inspection-media\/(.+)$/);
      if (pathMatch) {
        await supabase.storage.from('inspection-media').remove([pathMatch[1]]);
      }
    } catch (e) {
      console.warn('[inspection-api] Could not delete storage file:', e);
    }

    // Delete record
    const { error } = await supabase
      .from('inspection_media')
      .delete()
      .eq('id', mediaId);

    if (error) {
      console.error('[inspection-api] Error deleting media record:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('[inspection-api] Exception deleting media:', e);
    return false;
  }
}

// =============================================
// RECOMMENDATIONS
// =============================================

/**
 * Create a recommendation from an inspection item
 * @param {object} params 
 * @returns {Promise<object|null>}
 */
export async function createRecommendation({
  inspectionId,
  sectionIndex,
  itemIndex,
  serviceName,
  description = '',
  partsCost = 0,
  laborHours = 0,
  laborRate = 0
}) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  if (!supabase || !shopId || !inspectionId) return null;

  try {
    const totalPrice = partsCost + (laborHours * laborRate);

    const { data, error } = await supabase
      .from('inspection_recommendations')
      .insert({
        inspection_id: inspectionId,
        shop_id: shopId,
        section_index: sectionIndex,
        item_index: itemIndex,
        service_name: serviceName,
        description,
        parts_cost: partsCost,
        labor_hours: laborHours,
        labor_rate: laborRate,
        total_price: totalPrice,
        status: 'draft'
      })
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error creating recommendation:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('[inspection-api] Exception creating recommendation:', e);
    return null;
  }
}

/**
 * Get recommendations for an inspection
 * @param {string} inspectionId 
 * @returns {Promise<Array>}
 */
export async function getInspectionRecommendations(inspectionId) {
  const supabase = getSupabaseClient();
  if (!supabase || !inspectionId) return [];

  try {
    const { data, error } = await supabase
      .from('inspection_recommendations')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[inspection-api] Error fetching recommendations:', error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error('[inspection-api] Exception fetching recommendations:', e);
    return [];
  }
}

/**
 * Update recommendation status (customer decision)
 * @param {string} recommendationId 
 * @param {string} status - approved, declined
 * @param {string} customerNotes 
 * @returns {Promise<object|null>}
 */
export async function updateRecommendationStatus(recommendationId, status, customerNotes = '') {
  const supabase = getSupabaseClient();
  if (!supabase || !recommendationId) return null;

  try {
    const { data, error } = await supabase
      .from('inspection_recommendations')
      .update({
        status,
        customer_notes: customerNotes,
        customer_decision_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', recommendationId)
      .select()
      .single();

    if (error) {
      console.error('[inspection-api] Error updating recommendation:', error);
      return null;
    }

    return data;
  } catch (e) {
    console.error('[inspection-api] Exception updating recommendation:', e);
    return null;
  }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Check if an appointment/job has an inspection
 * @param {string} appointmentId 
 * @param {string} jobId 
 * @returns {Promise<{hasInspection: boolean, inspection: object|null}>}
 */
export async function checkForInspection(appointmentId, jobId = null) {
  let inspection = null;

  if (appointmentId) {
    inspection = await getInspectionByAppointmentId(appointmentId);
  }

  if (!inspection && jobId) {
    inspection = await getInspectionByJobId(jobId);
  }

  return {
    hasInspection: !!inspection,
    inspection
  };
}

/**
 * Get inspection summary for display (badge info)
 * @param {string} appointmentId 
 * @param {string} jobId 
 * @returns {Promise<object|null>} - { status, grade, failCount, highPriorityCount, badgeCount }
 */
export async function getInspectionSummary(appointmentId, jobId = null) {
  const { inspection } = await checkForInspection(appointmentId, jobId);
  
  if (!inspection) {
    return null;
  }

  return {
    id: inspection.id,
    status: inspection.status,
    grade: inspection.grade,
    failCount: inspection.fail_count,
    attentionCount: inspection.attention_count,
    passCount: inspection.pass_count,
    highPriorityCount: inspection.high_priority_count,
    unsafeToDrive: inspection.unsafe_to_drive,
    badgeCount: inspection.fail_count + inspection.high_priority_count
  };
}

// Export for global access
if (typeof window !== 'undefined') {
  window.InspectionAPI = {
    createInspection,
    getInspectionById,
    getInspectionByShareToken,
    getInspectionByAppointmentId,
    getInspectionByJobId,
    getShopInspections,
    updateInspectionSections,
    updateInspectionItem,
    updateInspectionStatus,
    updateInspectionNotes,
    setUnsafeToDrive,
    deleteInspection,
    uploadInspectionMedia,
    getInspectionMedia,
    deleteInspectionMedia,
    createRecommendation,
    getInspectionRecommendations,
    updateRecommendationStatus,
    checkForInspection,
    getInspectionSummary
  };
}
