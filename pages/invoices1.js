// invoices page logic extracted from app.js
// All logic is preserved 1:1, no changes

function setupInvoices(){
  if (setupInvoices._wired) return;
  setupInvoices._wired = true;
  
  // Auto-open modal if URL has #new
  if (window.location.hash === '#new') {
    setTimeout(() => {
      const modal = document.getElementById("invModal");
      if (modal) {
        modal.classList.remove("hidden");
        // Focus on customer input
        const custInput = document.getElementById("invCustomer");
        if (custInput) custInput.focus();
      }
    }, 100);
  }
  
  const data=readLS(LS.data,{invoices:[],appointments:[]});
  const shops=readLS("xm_shops",[]);const u=readLS(LS.session,{});const users=readLS(LS.users,[]);const cu=users.find(x=>x.email===u.email);const shopId=(cu?.shop_id);const currentShop=shops.find(s=>s.id===shopId);const shopName=(data.settings?.shop?.name)||(currentShop?.name)||"";const logo = data.settings?.shop?.logo;const footerEl=byId("footerShopName");if(footerEl)footerEl.textContent=shopName;
  const tb=document.querySelector("#invTable tbody");
  const empty=document.getElementById("invEmpty");
  const pbody=document.querySelector("#prevTable tbody");
  const pempty=document.getElementById("prevEmpty");

  const isMobile = (typeof window !== 'undefined') && window.matchMedia && window.matchMedia('(max-width:480px)').matches;

  // Update table headers for mobile
  const invThead = document.querySelector('#invTable thead tr');
  const prevThead = document.querySelector('#prevTable thead tr');
  if (invThead) {
    if (isMobile) {
      invThead.innerHTML = '<th>Customer</th><th>Total</th><th>Status</th><th>Actions</th>';
    } else {
      invThead.innerHTML = '<th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Due</th><th>Actions</th>';
    }
  }
  if (prevThead) {
    if (isMobile) {
      prevThead.innerHTML = '<th>Customer</th><th>Total</th><th>Status</th><th>Actions</th>';
    } else {
      prevThead.innerHTML = '<th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Due</th><th>Actions</th>';
    }
  }

  const modal=document.getElementById("invModal");
  const openBtn=document.getElementById("newInvoice");
  const closeBtn=document.getElementById("closeInv");
  const addBtn=document.getElementById("addItem");
  const saveBtn=document.getElementById("saveInv");

  const itemsDiv=document.getElementById("items");
  const taxI=document.getElementById("invTax");
  const discI=document.getElementById("invDisc");
  const dueI=document.getElementById("invDue");
  const subEl=document.getElementById("subTotal");
  const grandEl=document.getElementById("grandTotal");
  const custI=document.getElementById("invCustomer");
  const apptI=document.getElementById("invAppt");
  // ...existing code...
}

// Export for usage in app.js or direct module import
window.setupInvoices = setupInvoices;