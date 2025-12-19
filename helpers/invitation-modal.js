/**
 * helpers/invitation-modal.js
 * Vanilla JS implementation of the invitation modal for non-React app
 */
import { getSupabaseClient } from './supabase.js';
import { getCurrentUser } from './user.js';

const CSS = `
.invitation-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px}
.invitation-modal{background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.3);box-sizing:border-box;padding-bottom:16px}
.invitation-modal-header{padding:24px;border-bottom:1px solid #e5e7eb;text-align:center}
.invitation-modal-header h2{margin:0 0 8px 0;font-size:24px;color:#111827}
.invitation-modal-header p{margin:0;color:#6b7280;font-size:14px}
.invitation-list{padding:24px;display:flex;flex-direction:column;gap:16px}
.invitation-card{border:1px solid #e5e7eb;border-radius:8px;padding:20px;display:flex;gap:16px;align-items:flex-start;transition:box-shadow .2s}
.invitation-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.1)}
.invitation-icon{font-size:32px;flex-shrink:0}
.invitation-details{flex:1}
.invitation-details h3{margin:0 0 8px 0;font-size:18px;color:#111827}
.invitation-role{margin:4px 0;color:#6b7280;font-size:14px}
.invitation-role strong{color:#111827;text-transform:capitalize}
.invitation-from{margin:4px 0;color:#6b7280;font-size:14px}
.invitation-email{color:#9ca3af;font-size:12px;margin-left:4px}
.invitation-date{margin:8px 0 0 0;color:#9ca3af;font-size:12px}
.invitation-actions{display:flex;flex-direction:column;gap:8px;min-width:100px}
.btn-accept,.btn-decline{padding:8px 16px;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;transition:all .2s;border:none}
.btn-accept{background:#10b981;color:#fff}
.btn-accept:hover{background:#059669}
.btn-decline{background:#ef4444;color:#fff}
.btn-decline:hover{background:#dc2626}
.btn-view-later{width:calc(100% - 48px);margin:0 24px 24px 24px;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;transition:background .2s}
.btn-view-later:hover{background:#e5e7eb}
@media(max-width:640px){.invitation-card{flex-direction:column}.invitation-actions{flex-direction:row;width:100%}.invitation-actions button{flex:1}}
`;

let modalEl = null;

export async function initInvitationModal(){
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const user = await getCurrentUser();
  const userEmail = (user?.email || '').toLowerCase().trim();
  if (!userEmail) return;

  try {
    const { data, error } = await supabase
      .from('shop_invitations')
      .select(`*, shops(name), invited_by:users!invited_by_user_id(first, last, email)`)
      .eq('invited_email', userEmail)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;
    if (!data || data.length === 0) return;

    renderModal(data, supabase, user);
  } catch (ex) {
    console.warn('[invitation-modal] failed to fetch invitations', ex);
  }
}

function renderModal(invitations, supabase, user){
  // Inject styles
  if (!document.getElementById('invitationModalStyles')){
    const s = document.createElement('style'); s.id = 'invitationModalStyles'; s.textContent = CSS; document.head.appendChild(s);
  }

  // Build modal
  const overlay = document.createElement('div'); overlay.className = 'invitation-modal-overlay';
  overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');

  const modal = document.createElement('div'); modal.className = 'invitation-modal';

  const header = document.createElement('div'); header.className = 'invitation-modal-header';
  header.innerHTML = `<h2>Shop Invitations</h2><p>You have ${invitations.length} pending invitation${invitations.length>1?'s':''}</p>`;
  modal.appendChild(header);

  const list = document.createElement('div'); list.className = 'invitation-list';
  invitations.forEach(inv => {
    const card = document.createElement('div'); card.className = 'invitation-card'; card.dataset.invId = inv.id;
    const icon = document.createElement('div'); icon.className = 'invitation-icon'; icon.textContent = '🏪';
    const details = document.createElement('div'); details.className = 'invitation-details';
    const shopName = document.createElement('h3'); shopName.textContent = (inv.shops && inv.shops.name) ? inv.shops.name : 'Unknown Shop';
    const roleP = document.createElement('p'); roleP.className = 'invitation-role'; roleP.innerHTML = `Role: <strong>${inv.role}</strong>`;
    const fromP = document.createElement('p'); fromP.className = 'invitation-from'; fromP.innerHTML = `From: ${inv.invited_by?.first || ''} ${inv.invited_by?.last || ''} <span class="invitation-email">(${inv.invited_by?.email||''})</span>`;
    const dateP = document.createElement('p'); dateP.className = 'invitation-date'; dateP.textContent = `Sent ${new Date(inv.created_at).toLocaleDateString()}`;
    details.appendChild(shopName); details.appendChild(roleP); details.appendChild(fromP); details.appendChild(dateP);

    const actions = document.createElement('div'); actions.className = 'invitation-actions';
    const acceptBtn = document.createElement('button'); acceptBtn.className = 'btn-accept'; acceptBtn.textContent = 'Accept';
    const declineBtn = document.createElement('button'); declineBtn.className = 'btn-decline'; declineBtn.textContent = 'Decline';
    actions.appendChild(acceptBtn); actions.appendChild(declineBtn);

    acceptBtn.addEventListener('click', async () => {
      try {
        const { error: insErr } = await supabase.from('user_shops').insert({ user_id: user.id, shop_id: inv.shop_id, role: inv.role });
        if (insErr) throw insErr;
        const { error: upErr } = await supabase.from('shop_invitations').update({ status: 'accepted' }).eq('id', inv.id);
        if (upErr) throw upErr;
        card.remove();
        if (list.children.length === 0) closeModal();
        // reload to update UI/shop list
        window.location.reload();
      } catch (e) { console.error('[invitation-modal] accept failed', e); alert('Failed to accept invitation.'); }
    });

    declineBtn.addEventListener('click', async () => {
      try {
        const { error } = await supabase.from('shop_invitations').update({ status: 'declined' }).eq('id', inv.id);
        if (error) throw error;
        card.remove();
        if (list.children.length === 0) closeModal();
      } catch (e) { console.error('[invitation-modal] decline failed', e); alert('Failed to decline invitation.'); }
    });

    card.appendChild(icon); card.appendChild(details); card.appendChild(actions);
    list.appendChild(card);
  });

  modal.appendChild(list);

  const viewLater = document.createElement('button'); viewLater.className = 'btn-view-later'; viewLater.textContent = 'View Later';
  viewLater.addEventListener('click', closeModal);
  modal.appendChild(viewLater);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;
  // lock scroll
  document.documentElement.style.overflow = 'hidden';
}

function closeModal(){
  if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
  modalEl = null;
  document.documentElement.style.overflow = '';
}

export default { initInvitationModal };
