// Customer Row Modal for mobile actions (View/Delete)
export function showCustomerRowModal({ onView, onDelete }) {
  // Remove any existing modal
  let existing = document.getElementById('custRowActionModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'custRowActionModal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:320px">
      <div class="modal-head"><h3 style="margin:0">Customer Actions</h3></div>
      <div class="modal-body" style="padding:18px 14px 0 14px; text-align:center">
        <button class="btn info" id="custRowViewBtn" style="width:100%;margin-bottom:12px">View</button>
        <button class="btn danger" id="custRowDeleteBtn" style="width:100%">Delete</button>
      </div>
      <div class="modal-foot" style="justify-content:center">
        <button class="btn" id="custRowCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#custRowViewBtn').onclick = () => {
    modal.remove();
    if (onView) onView();
  };
  modal.querySelector('#custRowDeleteBtn').onclick = () => {
    modal.remove();
    if (onDelete) onDelete();
  };
  modal.querySelector('#custRowCancelBtn').onclick = () => {
    modal.remove();
  };

  // Dismiss on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
}
