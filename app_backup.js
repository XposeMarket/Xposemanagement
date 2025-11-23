const LS={users:"xm_users",session:"xm_session",data:"xm_data",seeded:"xm_seeded",shops:"xm_shops"};
// ==== PartsTech proxy config (safe global) ====
try {
  const ENDPOINT = "https://xpoe-partstech-proxy.xposemarket.workers.dev/search";
  self.PARTSTECH_CFG = self.PARTSTECH_CFG || Object.freeze({
    enabled: true,
    endpoint: ENDPOINT,
    fallbackToMock: true
  });
} catch(e){ console.error("PARTSTECH_CFG init error:", e); }

function readLS(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):(f??null);}catch(e){return f??null;}}
function writeLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function byId(id){return document.getElementById(id);} function todayISO(){return new Date().toISOString().slice(0,10);} function fmtMoney(n){return Number(n||0).toFixed(2);}
/* === EDIT #7: Auto-invoice helper (create-or-reuse by appointment_id) === */
function ensureInvoiceForAppt(apptId){
  try{
    const d = readLS(LS.data,{appointments:[],invoices:[]});
    if(!d) return null;
    // reuse existing (open or paid)
    let inv = (d.invoices||[]).find(i => i.appointment_id === apptId);
    if(inv) return inv;

    const appt = (d.appointments||[]).find(a => a.id === apptId) || null;
    const next = (d.invoices||[]).reduce((mx,i)=>Math.max(mx, Number(i.number||0)||0), 1000) + 1;
    inv = {
      id: "inv"+Date.now(),
      number: String(next),
      customer: appt ? (`${appt.customer_first||""} ${appt.customer_last||""}`.trim() || "Walk-in") : "Walk-in",
      appointment_id: apptId,
      status: "open",
      due: todayISO(),
      tax_rate: 6,
      discount: 0,
      items: [{ name: "Item", qty: 1, price: 0 }]
    };
    d.invoices = d.invoices || [];
    d.invoices.push(inv);
    writeLS(LS.data, d);
    return inv;
  }catch(_e){ return null; }
}
/* === /EDIT #7 === */

function openApptModalWith(appt) {
  const modal = document.getElementById('apptModal');
  const form  = document.getElementById('apptForm');
  if (!modal || !form) { console.warn('appt modal/form missing'); return; }

  form.reset();
  if (appt && appt.id) {
    form.dataset.mode = 'edit';
    form.dataset.apptId = appt.id;
    const title = document.getElementById('apptModalTitle');
    if (title) title.textContent = 'Edit Appointment';
  } else {
    form.dataset.mode = 'create';
    form.dataset.apptId = '';
    const title = document.getElementById('apptModalTitle');
    if (title) title.textContent = 'Create Appointment';
  }

if (appt) {
  Object.keys(appt).forEach(k => {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!appt[k];
    else el.value = (appt[k] ?? '').toString();
  });

  // === Add this block ===
  try { 
    populateServiceOptions(); // reuse New Appt dropdown
    const serviceInput = form.querySelector('[name="service"]');
    if (serviceInput) serviceInput.value = appt.service || "";
  } catch(e) {
    console.warn("couldn't populate services", e);
  }
  // === /Add this block ===
}

modal.classList.remove('hidden');
modal.classList.add('open');

}

function closeApptModal() {
  const modal = document.getElementById('apptModal');
  if (modal) { modal.classList.remove('open'); modal.classList.add('hidden'); }
}

function isEditingAppt(form) {
  return form?.dataset.mode === 'edit' && form.dataset.apptId;
}


/* === PARTSTECH MOCK + PARTS FINDER === */
let __partsCtx = null;

function openPartsFinder(ctx){
  __partsCtx = ctx || __partsCtx || {};
  const m = byId("partsModal");
  if(!m) return;
  const v = byId("pfVehicle");
  const q = byId("pfQuery");
  const r = byId("pfResults");
  const n = byId("pfNote");
  const vinI = byId("pfVin");                 
  if(v) v.value = (__partsCtx.vehicle||"").trim();
  if(q) q.value = "";
  if(r) r.innerHTML = "";
  if(n) n.textContent = "Type a keyword and click Search.";
  if(vinI) vinI.value = (__partsCtx.vin||"").trim();
  m.classList.remove("hidden");
}
function closePartsFinder(){
  const m = byId("partsModal");
  if(m) m.classList.add("hidden");
  __partsCtx = null;
}
// One global click delegator for the parts modal
document.addEventListener("click", async (e) => {
  const id = e.target?.id;

  if (id === "closeParts") {
    closePartsFinder();
    return;
  }

  if (id === "pfSearch") {
    const btn = e.target;
    const v   = byId("pfVehicle")?.value || "";
    const vin = byId("pfVin")?.value?.trim() || "";
    const q   = byId("pfQuery")?.value?.trim() || "";
    const n   = byId("pfNote");

    if (!q && !vin) {
      if (n) n.textContent = "Enter a keyword or VIN.";
      return;
    }

    const vehicleToSend = vin || v;
    if (n) n.textContent = "Searching…";
    btn.disabled = true;

    try {
      let results = [];

      if (self.PARTSTECH_CFG?.endpoint) {
        const res = await fetch(PARTSTECH_CFG.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // include supplier hint since you’re approved for Carquest
          body: JSON.stringify({ vehicle: vehicleToSend, vin, query: q, supplier: "carquest" })
        });

        const data = await res.json();
        results = data?.results || [];
      } else {
        results = (typeof mockPartsSearch === "function")
          ? mockPartsSearch(vehicleToSend, q)
          : [];
      }

      renderPartsResults(results);
      if (n) n.textContent = results.length ? "" : "No results for that query.";
    } catch (err) {
      console.warn("Find Parts search error – falling back to mock", err);
      const results = (typeof mockPartsSearch === "function")
        ? mockPartsSearch(vehicleToSend, q)
        : [];
      renderPartsResults(results);
      if (n) n.textContent = results.length ? "Showing mock results." : "No results.";
    } finally {
      btn.disabled = false;
    }
  }
});

/* === LABOR PER PART MODAL (add-before-invoice) === */
let __laborCtx = null;

function __ensureLaborRateSeed(){
  const d = readLS(LS.data, { settings:{}, appointments:[], invoices:[] });
  d.settings = d.settings || {};
  if(!Array.isArray(d.settings.labor_rates)){
    d.settings.labor_rates = [
      { name: "Standard", rate: 120 },
      { name: "Premium",  rate: 150 }
    ];
    writeLS(LS.data, d);
  }
  return d.settings.labor_rates;
}
function __getLaborRates(){ return (__ensureLaborRateSeed(), (readLS(LS.data,{settings:{}}).settings.labor_rates||[])); }
function __saveLaborRates(list){
  const d = readLS(LS.data, { settings:{}, appointments:[], invoices:[] });
  d.settings = d.settings || {};
  d.settings.labor_rates = list;
  writeLS(LS.data, d);
}

function openLaborModal(ctx){
  __laborCtx = ctx; // { apptId, part }
  const m = byId("laborModal");
  if(!m) return;
  // fill dropdown
  const sel = byId("labRateSel");
  const rateInput = byId("labRate");
  const note = byId("labNote");
  if(note) note.textContent = "";
  const hrs = byId("labHours"); if(hrs) hrs.value = "1";
  if(sel){
    const rates = __getLaborRates();
    sel.innerHTML = `<option value="">Custom</option>` + rates.map(r=>(
      `<option value="${Number(r.rate)}">${r.name} ($${fmtMoney(r.rate)}/hr)</option>`
    )).join("");
  }
  if(rateInput) rateInput.value = "";

  m.classList.remove("hidden");
}
function closeLaborModal(){
  const m = byId("laborModal");
  if(m) m.classList.add("hidden");
  __laborCtx = null;
}

document.addEventListener("click", (e)=>{
  if(e.target && (e.target.id === "labCancel" || e.target.id === "labClose")){ 
    closeLaborModal(); 
  }
  if(e.target && e.target.id === "labAddRate"){
    const name = prompt("Name this rate (e.g., Standard):", "");
    if(!name) return;
    const val = prompt("Rate amount (per hour):", "120");
    const rate = Number(val);
    if(isNaN(rate) || rate < 0){ alert("Enter a valid non-negative number."); return; }
    const list = __getLaborRates().slice();
    list.push({ name: String(name).trim(), rate });
    __saveLaborRates(list);

    // refresh dropdown and select the new one
    const sel = byId("labRateSel");
    if(sel){
      sel.innerHTML = `<option value="">Custom</option>` + list.map(r=>(
        `<option value="${Number(r.rate)}">${r.name} ($${fmtMoney(r.rate)}/hr)</option>`
      )).join("");
      sel.value = String(rate);
      const rateInput = byId("labRate");
      if(rateInput) rateInput.value = String(rate);
    }
  }
  if(e.target && e.target.id === "labConfirm"){
    const hrs = Number((byId("labHours")||{}).value||0);
    const rateInput = byId("labRate");      // may not exist in jobs.html
   const rateSel   = byId("labRateSel");
    const rate = Number(rateInput ? rateInput.value : (rateSel ? rateSel.value : 0));
    const note = byId("labNote");

    if(!( __laborCtx && __laborCtx.apptId && __laborCtx.part )){
      alert("Missing context."); return;
    }
    if(isNaN(hrs) || hrs <= 0){ if(note) note.textContent = "Hours must be > 0."; return; }
    if(isNaN(rate) || rate < 0){ if(note) note.textContent = "Rate must be a non-negative number."; return; }

    // Add part + labor lines in one atomic write
    const ok = addPartAndLaborToInvoice(__laborCtx.apptId, __laborCtx.part, { hours: hrs, rate });
    if(ok){
      if(note) note.textContent = `Added part + labor to invoice for appointment ${__laborCtx.apptId}.`;
      setTimeout(()=>{ closeLaborModal(); closePartsFinder(); }, 500);
    }else{
      if(note) note.textContent = "Unable to add to invoice. Try again.";
    }
  }
});

document.addEventListener("change", (e)=>{
  if(e.target && e.target.id === "labRateSel"){
    const v = e.target.value;
    const r = byId("labRate");
    if(r) r.value = v || r.value; // when "Custom" selected, leave whatever is typed
  }
});
/* === /LABOR PER PART MODAL === */

async function partsTechSearch(vehicle, query){
  try {
    const apiKey = "YOUR_PARTSTECH_KEY"; // you’d load this securely, not in client JS
    const url = `https://api.partstech.com/catalog/search?q=${encodeURIComponent(query)}&vehicle=${encodeURIComponent(vehicle)}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (!res.ok) throw new Error("PartsTech request failed");
    const data = await res.json();

    // Map API response into your UI format
    return (data.results || []).map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      vendor: "PartsTech",
      price: p.price,
      vehicle: vehicle || ""
    }));
  } catch (e) {
    console.warn("PartsTech error", e);
    return [];
  }
}



function renderPartsResults(list){
  const r = byId("pfResults");
  const n = byId("pfNote");
  if(!r) return;
  if(!list || !list.length){
    r.innerHTML = "";
    if(n) n.textContent = "No results for that keyword.";
    return;
  }
  if(n) n.textContent = "";
  r.innerHTML = "";
  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Part</th><th>Brand</th><th>Price</th><th>Vendor</th><th>Actions</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  list.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${(p.name||"").toString()}</td>
      <td>${(p.brand||"-").toString()}</td>
      <td>$${fmtMoney(p.price||0)}</td>
      <td>${(p.vendor||"-").toString()}</td>
      <td><button class="btn" data-add-part="${p.id}">Add to Invoice</button></td>`;
    // attach handler
    tr.querySelector("[data-add-part]").addEventListener("click", ()=>{
      if(!__partsCtx || !__partsCtx.apptId){
        alert("Missing appointment context."); return;
      }
      // hand off to Labor modal with the selected part + appt
      openLaborModal({ apptId: __partsCtx.apptId, part: p });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  r.appendChild(table);
}
// Add BOTH a Part line AND a Labor line (qty = hours, price = rate)
function addPartAndLaborToInvoice(apptId, part, labor) {
  try {
    const d   = readLS(LS.data, { appointments:[], invoices:[] });
    const inv = getOrCreateOpenInvoice(apptId);
    if (!inv) return false;

    const idx = (d.invoices||[]).findIndex(i => i.id === inv.id);
    if (idx < 0) return false;

    const items = d.invoices[idx].items = d.invoices[idx].items || [];

    // 1) Part line
    const partLine = {
      name: `Part: ${(part.name||"").toString()}${part.brand ? (" · " + part.brand) : ""}`,
      qty: 1,
      price: Number(part.price||0)
    };
    items.push(partLine);

    // 2) Labor line (qty = hours, price = rate)
    const hours = Number(labor && labor.hours || 0);
    const rate  = Number(labor && labor.rate  || 0);
    const laborLine = {
      name: `Labor - ${(part.name||"").toString()}`,
      qty: hours,
      price: rate
    };
    items.push(laborLine);

    writeLS(LS.data, d);
    return true;
  } catch(e) {
    console.warn("addPartAndLaborToInvoice error", e);
    return false;
  }
}

// Create or reuse an OPEN invoice for this appt; if paid, create a new one.
function getOrCreateOpenInvoice(apptId){
  const d = readLS(LS.data,{appointments:[],invoices:[]});
  let inv = (d.invoices||[]).find(i => i.appointment_id===apptId && (i.status||"open")!=="paid");
  if(inv) return inv;
  // fall back: any invoice by appt
  inv = (d.invoices||[]).find(i => i.appointment_id===apptId);
  if(inv && (inv.status||"open")==="paid"){
    // create a new one
    const next = (d.invoices||[]).reduce((mx,i)=>Math.max(mx, Number(i.number||0)||0), 1000) + 1;
    const appt = (d.appointments||[]).find(a => a.id===apptId) || null;
    inv = {
      id: "inv"+Date.now(),
      number: String(next),
      customer: appt ? (`${appt.customer_first||""} ${appt.customer_last||""}`.trim() || "Walk-in") : "Walk-in",
      appointment_id: apptId,
      status: "open",
      due: todayISO(),
      tax_rate: 6,
      discount: 0,
      items: []
    };
    d.invoices.push(inv);
    writeLS(LS.data, d);
    return inv;
  }
  // else create new
  return ensureInvoiceForAppt(apptId);
}


// --- Service helpers (top of app.js) ---
function _getDataSafe(){ try { return readLS(LS.data, {}) || {}; } catch(e){ return {}; } }
function _curShopId(){ try { const s=currentShop&&currentShop(); return s&&s.id; } catch(e){ return null; } }

function getServiceConfigById(sid){
  if(!sid) return null;
  const d=_getDataSafe(); const list=(d.settings&&d.settings.services)||[]; const cur=_curShopId();
  return list.find(s=>String(s.id)===String(sid)&&(!s.shop_id||s.shop_id===cur))||null;
}

function getServiceConfigByName(name){
  if(!name) return null;
  const d=_getDataSafe(); const list=(d.settings&&d.settings.services)||[]; const cur=_curShopId();
  const lower=String(name).toLowerCase();
  return list.find(s=>String(s.name||"").toLowerCase()===lower&&(!s.shop_id||s.shop_id===cur))||null;
}

function _apptPrefillKey(apptId){ return `nx_appt_prefilled_${String(apptId)}`; }


function addPartToInvoice(apptId, part){
  try{
    const d = readLS(LS.data,{appointments:[],invoices:[]});
    const inv = getOrCreateOpenInvoice(apptId);
    if(!inv) return false;
    const idx = (d.invoices||[]).findIndex(i => i.id===inv.id);
    if(idx<0) return false;
    const line = {
      name: `Part: ${(part.name||"").toString()}${part.brand?(" · "+part.brand):""}`,
      qty: 1,
      price: Number(part.price||0)
    };
    d.invoices[idx].items = d.invoices[idx].items || [];
    d.invoices[idx].items.push(line);
    writeLS(LS.data, d);
    return true;
  }catch(e){ return false; }
}
// Add BOTH a Part line AND a Labor line (qty = hours, price = rate)
function addPartAndLaborToInvoice(apptId, part, labor) {
  try {
    const d   = readLS(LS.data, { appointments:[], invoices:[] });
    const inv = getOrCreateOpenInvoice(apptId);
    if (!inv) return false;

    const idx = (d.invoices||[]).findIndex(i => i.id === inv.id);
    if (idx < 0) return false;

    const items = d.invoices[idx].items = d.invoices[idx].items || [];

    // 1) Part line
    const partLine = {
      name: `Part: ${(part.name||"").toString()}${part.brand ? (" · " + part.brand) : ""}`,
      qty: 1,
      price: Number(part.price||0)
    };
    items.push(partLine);

    // 2) Labor line (qty = hours, price = rate)
    const hours = Number(labor && labor.hours || 0);
    const rate  = Number(labor && labor.rate  || 0);
    const laborLine = {
      name: `Labor - ${(part.name||"").toString()}`,
      qty: hours,
      price: rate
    };
    items.push(laborLine);

    writeLS(LS.data, d);
    return true;
  } catch(e) {
    console.warn("addPartAndLaborToInvoice error", e);
    return false;
  }
}

/* === /PARTSTECH MOCK + PARTS FINDER === */


const ROLE_PAGES={admin:["dashboard","invoice","appointments","jobs","messages","invoices","customers","settings","profile"],service_writer:["dashboard","invoice","customers","appointments","messages","invoices","profile"],receptionist:["dashboard","messages","customers","appointments","profile"],staff:["dashboard","appointments","jobs","profile"]};
function currentUser(){const s=readLS(LS.session,null);if(!s)return null;return readLS(LS.users,[]).find(x=>x.email===s.email)||null;}
function currentShop(){const u=currentUser();const shops=readLS(LS.shops,[])||[];return u?shops.find(s=>s.id===u.shop_id)||shops[0]||null:shops[0]||null;}
async function __ensureSeedBase(){if(readLS(LS.seeded,false))return;writeLS(LS.users,[{id:"u1",first:"Owner",last:"User",email:"owner@xpose.test",password:"admin123",role:"admin",shop_id:"s1"}]);writeLS(LS.shops,[{id:"s1",name:"Xpose Management",type:"Mechanic",join_code:"ABCD12",staff_limit:3}]);writeLS(LS.data,{settings:{shop:{name:"Xpose Management",phone:"",email:""}},appointments:[{id:"a1",created_at:new Date().toISOString(),customer_first:"Evan",customer_last:"Ramos",email:"evan.ramos@example.com",phone:"(301) 555-0182",vehicle:"2014 BMW 335i",service:"Brake inspection",preferred_date:todayISO(),preferred_time:"10:00",status:"scheduled",source:"inquiry",shop_id:"s1"}],jobs:[{id:"J1001",appointment_id:"a1",status:"scheduled",shop_id:"s1"}],threads:[{id:"t1",type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}],shop_id:"s1"}],invoices:[{id:"inv1001",number:"1001",customer:"Evan Ramos",appointment_id:"a1",status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Labor",qty:1,price:120},{name:"Parts",qty:1,price:45}],shop_id:"s1"}]});writeLS(LS.seeded,true);}
function setThemeFromUser(){const u=currentUser();const t=(u&&u.theme)||"light";document.documentElement.classList.toggle("dark",t==="dark");}
function toggleTheme(){const html=document.documentElement;html.classList.toggle("dark");const dark=html.classList.contains("dark");const u=currentUser();if(!u)return;const users=readLS(LS.users,[]);const i=users.findIndex(x=>x.id===u.id);if(i>=0){users[i].theme=dark?"dark":"light";writeLS(LS.users,users);}}
function pageName(){const p=(location.pathname.split("/").pop()||"index.html").toLowerCase();return p.replace(".html","");}
function applyNavPermissions(){const u=currentUser();if(!u)return;const allowed=ROLE_PAGES[u.role]||[];document.querySelectorAll("header nav a").forEach(a=>{const href=(a.getAttribute("href")||"").toLowerCase();const pn=href.replace(".html","").replace("./","");if(href&&pn&&!allowed.includes(pn)){a.style.display="none";}});}
function enforcePageAccess(){const u=currentUser();if(!u)return;const allowed=ROLE_PAGES[u.role]||[];const pn=pageName();const open=["index","signup","create-shop"];if(!allowed.includes(pn)&&!open.includes(pn)){if(allowed.includes("dashboard"))location.href="dashboard.html";else location.href="index.html";}}
function requireAuth(){const u=currentUser();const pn=pageName();const open=["index","signup","create-shop",""];if(!u&&!open.includes(pn))location.href="index.html";if(u){applyNavPermissions();enforcePageAccess();}}
function logout(){localStorage.removeItem(LS.session);location.href="index.html";}
async function ensureSeed(){await __ensureSeedBase();}
async function __mainBase(){await ensureSeed();setThemeFromUser();if(byId("themeToggle"))byId("themeToggle").addEventListener("click",toggleTheme);if(byId("logoutBtn"))byId("logoutBtn").addEventListener("click",logout);const p=pageName();if(p==="index"||p==="")setupLogin();else{requireAuth();if(p==="dashboard")setupDashboard();if(p==="appointments")setupAppointments();if(p==="jobs")setupJobs();if(p==="messages")setupMessages();if(p==="invoices")setupInvoices();if(p==="settings")setupSettings();if(p==="profile")setupProfile();}}
function makeSortable(table,rowBuilder){if(!table)return;const thead=table.querySelector("thead");const tbody=table.querySelector("tbody");let sortKey=null,sortDir=1;if(!thead)return;thead.querySelectorAll("th").forEach(th=>{th.style.cursor="pointer";th.addEventListener("click",()=>{const key=th.getAttribute("data-key")||th.textContent.toLowerCase().trim();sortDir=(sortKey===key)?-sortDir:1;sortKey=key;const rows=rowBuilder();rows.sort((a,b)=>{const va=a[key],vb=b[key];const na=!isNaN(parseFloat(va))&&isFinite(va);const nb=!isNaN(parseFloat(vb))&&isFinite(vb);if(na&&nb)return(parseFloat(va)-parseFloat(vb))*sortDir;if(/^\\d{4}-\\d{2}-\\d{2}$/.test(va||"")&&/^\\d{4}-\\d{2}-\\d{2}$/.test(vb||""))return(va.localeCompare(vb))*sortDir;return String(va||"").localeCompare(String(vb||""))*sortDir;});tbody.innerHTML="";rows.forEach(r=>tbody.appendChild(r.__tr));});});}
function setupLogin(){const form=byId("loginForm");if(!form)return;form.addEventListener("submit",(e)=>{e.preventDefault();const email=byId("loginEmail").value.trim().toLowerCase();const pass=byId("loginPass").value;const u=readLS(LS.users,[]).find(x=>x.email===email&&x.password===pass);if(!u){byId("loginErr").textContent="Invalid credentials.";return;}writeLS(LS.session,{email:u.email,at:Date.now()});location.href="dashboard.html";});}
function setupDashboard(){const data=readLS(LS.data,{appointments:[],jobs:[],invoices:[]});const ref=new Date();function kpis(){const ym=ref.toISOString().slice(0,7);const appts=data.appointments.filter(a=>(a.preferred_date||"").startsWith(ym));const leads=data.appointments.filter(a=>(a.created_at||"").slice(0,7)===ym);const jobs=data.jobs.filter(j=>j.status!=="completed");const openInv=data.invoices.filter(i=>i.status!=="paid");byId("kpiLeads").textContent=leads.length;byId("kpiAppts").textContent=appts.length;byId("kpiJobs").textContent=jobs.length;byId("kpiInv").textContent=openInv.length;}function renderCal(){byId("monthLabel").textContent=ref.toLocaleString(undefined,{month:"long",year:"numeric"});const grid=byId("calGrid");grid.innerHTML="";const y=ref.getFullYear(),m=ref.getMonth();const first=new Date(y,m,1),start=first.getDay();const days=new Date(y,m+1,0).getDate();for(let i=0;i<start;i++){const d=document.createElement("div");grid.appendChild(d);}for(let d=1;d<=days;d++){const cell=document.createElement("div");cell.className="day";const iso=new Date(y,m,d).toISOString().slice(0,10);const appts=data.appointments.filter(a=>a.preferred_date===iso&&a.status!=="completed");const counts={new:0,scheduled:0,in_progress:0,awaiting_parts:0,completed:0};appts.forEach(a=>counts[a.status]=(counts[a.status]||0)+1);cell.innerHTML=`<div class="date">${d}</div>

<div class="dotRow">
  ${counts.new?'<span class="chip"><span class="dot big open"></span><span>New</span></span>':''}
  ${counts.scheduled?'<span class="chip"><span class="dot big scheduled"></span><span>Sch</span></span>':''}
  ${counts.in_progress?'<span class="chip"><span class="dot big progress"></span><span>Prog</span></span>':''}
  ${counts.awaiting_parts?'<span class="chip"><span class="dot big progress"></span><span>Parts</span></span>':''}
  ${counts.completed?'<span class="chip"><span class="dot big done"></span><span>Done</span></span>':''}
</div>
<div class="tooltip" role="tooltip" aria-hidden="true">New:${counts.new||0} · Sch:${counts.scheduled||0} · Prog:${counts.in_progress||0} · Parts:${counts.awaiting_parts||0} · Done:${counts.completed||0}</div>`;cell.setAttribute('tabindex','0');
cell.setAttribute('role','button');
cell.addEventListener("click",()=>{
  renderDay(appts);
  const tip = cell.querySelector('.tooltip');
  if(tip){
    const open = document.querySelector('.day .tooltip.show');
    if(open && open!==tip){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
    const now = tip.classList.toggle('show');
    tip.setAttribute('aria-hidden', now ? 'false' : 'true');
  }
});
cell.addEventListener('keydown',(ev)=>{
  if(ev.key==='Enter' || ev.key===' '){
    ev.preventDefault();
    const tip = cell.querySelector('.tooltip');
    if(tip){
      const open = document.querySelector('.day .tooltip.show');
      if(open && open!==tip){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
      const now = tip.classList.toggle('show');
      tip.setAttribute('aria-hidden', now ? 'false' : 'true');
    }
  }
});grid.appendChild(cell);}}function badge(st){const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;}function renderDay(appts){const tb=document.querySelector("#dayTable tbody");tb.innerHTML="";const empty=byId("dayEmpty");if(!appts.length){empty.textContent="No appointments for this day.";return;}empty.textContent="";appts.forEach(a=>{const tr=document.createElement("tr");tr.innerHTML=`<td>${a.preferred_time||""}</td><td>${a.customer_first||""} ${a.customer_last||""}</td><td>${a.vehicle||""}</td><td>${a.service||""}</td><td>${badge(a.status)}</td><td><a class="btn" href="messages.html?appt=${a.id}">Message</a> <a class="btn" href="invoices.html?appt=${a.id}">Invoice</a></td>`;tb.appendChild(tr);});}// === Month navigation (must live inside setupDashboard so it sees ref/kpis/renderCal) ===
function resetDayPanel(){
  const tb = document.querySelector("#dayTable tbody");
  if (tb) tb.innerHTML = "";
  const empty = byId("dayEmpty");
  if (empty) empty.textContent = "Click a day to view appointments.";
  const open = document.querySelector(".day .tooltip.show");
  if (open){ open.classList.remove("show"); open.setAttribute("aria-hidden","true"); }
}

const prevBtn = byId("monthPrev");
const nextBtn = byId("monthNext");

if (prevBtn) prevBtn.addEventListener("click", () => {
  ref.setMonth(ref.getMonth() - 1);
  kpis();
  renderCal();
  resetDayPanel();
});

if (nextBtn) nextBtn.addEventListener("click", () => {
  ref.setMonth(ref.getMonth() + 1);
  kpis();
  renderCal();
  resetDayPanel();
});
// === /Month navigation ===
kpis();renderCal();}

// Helper: reset the day details/tooltip when month changes
function resetDayPanel(){
  const tb = document.querySelector("#dayTable tbody");
  if (tb) tb.innerHTML = "";
  const empty = byId("dayEmpty");
  if (empty) empty.textContent = "Click a day to view appointments.";
  const open = document.querySelector(".day .tooltip.show");
  if (open){ open.classList.remove("show"); open.setAttribute("aria-hidden","true"); }
}

// Wire month navigation
const prevBtn = byId("monthPrev");
const nextBtn = byId("monthNext");

if (prevBtn) prevBtn.addEventListener("click", () => {
  ref.setMonth(ref.getMonth() - 1);
  kpis();
  renderCal();
  resetDayPanel();
});

if (nextBtn) nextBtn.addEventListener("click", () => {
  ref.setMonth(ref.getMonth() + 1);
  kpis();
  renderCal();
  resetDayPanel();
});


// EDIT #6: Close open calendar tooltip on outside click / ESC
document.addEventListener('click', (ev)=>{
  const open = document.querySelector('.day .tooltip.show');
  if(!open) return;
  const day = open.closest('.day');
  if(day && day.contains(ev.target)) return;
  open.classList.remove('show'); open.setAttribute('aria-hidden','true');
});
document.addEventListener('keydown', (ev)=>{
  if(ev.key==='Escape'){
    const open = document.querySelector('.day .tooltip.show');
    if(open){ open.classList.remove('show'); open.setAttribute('aria-hidden','true'); }
  }
});
// /EDIT #6
function setupAppointments(){
  const modal = byId("newApptModal"); // open/close/save still use this create-only modal
  const openBtn=byId("newAppt");
  const closeBtn=byId("closeAppt");
  const saveBtn=byId("saveAppt");
// after
if (openBtn) openBtn.onclick = () => {
  try { populateServiceOptions(); } catch(e) { console.warn("svc options", e); }
  modal.classList.remove("hidden");
};

if(closeBtn)closeBtn.onclick=()=>modal.classList.add("hidden");if(saveBtn)saveBtn.onclick=()=>{const store=readLS(LS.data,{appointments:[]});const first=(byId("naFirst")||{}).value?.trim()||"";const last=(byId("naLast")||{}).value?.trim()||"";const phone=(byId("naPhone")||{}).value?.trim()||"";const vehicle=(byId("naVehicle")||{}).value?.trim()||"";const
vin=(byId("naVin") || {}).value?.trim() || "";const
service=(byId("naService")||{}).value?.trim()||"";const date=(byId("naDate")||{}).value||"";const time=(byId("naTime")||{}).value||"";const email=(byId("naEmail")||{}).value?.trim()||"";if(!first||!last||!phone||!vehicle||!service){alert("Please fill required fields.");return;}store.appointments.push({id:"a"+Date.now(),created_at:new Date().toISOString(),customer_first:first,customer_last:last,email,phone,vehicle,service,preferred_date:date,preferred_time:time,status:"new",source:"walk-in", vin});writeLS(LS.data,store);modal.classList.add("hidden");draw();};function badge(st){const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const sel=tr.querySelector(".statusSel");
sel.addEventListener("change",()=>{
  const st=readLS(LS.data,{appointments:[],jobs:[]});
  const i=st.appointments.findIndex(x=>x.id===a.id);
  if(i>=0){st.appointments[i].status=sel.value;}
  if(sel.value==="in_progress"){
    if(!(st.jobs||[]).some(j=>j.appointment_id===a.id)){
      (st.jobs=st.jobs||[]).push({id:"J"+Date.now(),appointment_id:a.id,status:"in_progress"});
    }
  }
  const ji=(st.jobs||[]).findIndex(j=>j.appointment_id===a.id);
  if(ji>=0){st.jobs[ji].status=sel.value;}

  /* INJECT: auto-invoice + merge-safe write */
  let __inv = null;
  if (sel.value === "completed") {
    try { 
      __inv = ensureInvoiceForAppt(a.id);
      // NEW: also push the appointment’s service into it
      prefillInvoiceFromAppointment(a);
    } catch(_e) {}
  }

  const __latestA = readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]});
  __latestA.appointments = st.appointments;
  __latestA.jobs = st.jobs;
  writeLS(LS.data, __latestA);
  draw();
});
const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;}function draw(){const store=readLS(LS.data,{appointments:[]});const q=(byId("apptSearch")||{}).value?.toLowerCase()||"";const status=(byId("apptStatus")||{}).value||"";const rows=(store.appointments||[]).filter(a=>{const hay=`${a.customer_first} ${a.customer_last} ${a.vehicle} ${a.service}`.toLowerCase();const okQ=!q||hay.includes(q);const okS=(!status? a.status!=="completed":a.status===status);return okQ&&okS;});const tbody=document.querySelector("#apptTable tbody");tbody.innerHTML="";if(!rows.length){byId("apptEmpty").textContent="No appointments match.";return;}byId("apptEmpty").textContent="";// Close button for the EDIT modal
document.getElementById('closeApptModal')?.addEventListener('click', closeApptModal);

// Submit handler for the EDIT modal
document.getElementById('apptForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());

  const d = (typeof _getData === 'function') ? _getData() : readLS(LS.data, {});
  const list = d.appointments || [];

  if (isEditingAppt(form)) {
    const id = form.dataset.apptId;
    const idx = list.findIndex(a => String(a.id) === String(id));
    if (idx !== -1) list[idx] = { ...list[idx], ...data, id };
  } else {
    const id = crypto?.randomUUID?.() || String(Date.now());
    list.push({ id, ...data });
  }

  if (typeof _setData === 'function') _setData({ ...d, appointments: list });
  else writeLS(LS.data, { ...d, appointments: list });

  closeApptModal();
  setupAppointments?.();
});
const rowObjs=rows.map(a=>{const tr=document.createElement("tr");tr.innerHTML = 
`

  <td>${(a.created_at||"").slice(0,10)}</td>
  <td>${a.customer_first} ${a.customer_last}</td>
  <td>${a.vehicle}</td>
<td>
  <div class="svc-toggle" data-id="${a.id}">
    <span class="svc-label">${a.service || ""}</span>
    <div class="svc-notes hidden">${a.notes || "No notes"}</div>
  </div>
</td>
  <td>${a.preferred_date||""}</td>
  <td>${a.preferred_time||""}</td>
  <td>
    <select class="statusSel">
      <option value="new"${a.status==='new'?' selected':''}>new</option>
      <option value="scheduled"${a.status==='scheduled'?' selected':''}>scheduled</option>
      <option value="in_progress"${a.status==='in_progress'?' selected':''}>in_progress</option>
      <option value="awaiting_parts"${a.status==='awaiting_parts'?' selected':''}>awaiting_parts</option>
      <option value="completed"${a.status==='completed'?' selected':''}>completed</option>
    </select>
  </td>
  <td class="appt-actions">
    <a class="btn btn-sm" href="messages.html?appt=${a.id}">Message</a>
    <a class="btn btn-sm" href="invoices.html?appt=${a.id}">Invoice</a>
    <button class="btn btn-sm danger" data-remove="${a.id}">Remove</button>
    <button class="btn btn-sm btn-secondary edit-appt" data-id="${a.id}">Edit</button>
  </td>

`;
// Toggle notes on Service click (Appointments table)
const svcWrap = tr.querySelector(".svc-toggle");
const notesEl = svcWrap?.querySelector(".svc-notes");
if (svcWrap && notesEl) {
  svcWrap.addEventListener("click", (e) => {
    // don't let clicks on links/buttons above bubble if any
    e.stopPropagation?.();
    const isOpen = svcWrap.classList.toggle("open");
    // keep .hidden in sync in case other CSS relies on it
    notesEl.classList.toggle("hidden", !isOpen);
  });
}

const sel=tr.querySelector(".statusSel");sel.addEventListener("change",()=>{const st=readLS(LS.data,{appointments:[],jobs:[]});const i=st.appointments.findIndex(x=>x.id===a.id);if(i>=0){st.appointments[i].status=sel.value;}if(sel.value==="in_progress"){if(!(st.jobs||[]).some(j=>j.appointment_id===a.id)){(st.jobs=st.jobs||[]).push({id:"J"+Date.now(),appointment_id:a.id,status:"in_progress"});} }const ji=(st.jobs||[]).findIndex(j=>j.appointment_id===a.id);if(ji>=0){st.jobs[ji].status=sel.value;}/* INJECT: auto-invoice + merge-safe write */let __inv = null; if (sel.value === "completed") { try { __inv = ensureInvoiceForAppt(a.id); } catch(_e) {} } const __latestA = readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]}); __latestA.appointments = st.appointments; __latestA.jobs = st.jobs; writeLS(LS.data, __latestA); draw();});tr.querySelector('button[data-remove]').addEventListener('click',()=>{const st=readLS(LS.data,{appointments:[]});st.appointments=(st.appointments||[]).filter(x=>x.id!==a.id);writeLS(LS.data,st);draw();});
// NEW: Edit button -> open the edit modal prefilled
const editBtn = tr.querySelector('.edit-appt');
if (editBtn) {
  editBtn.addEventListener('click', () => {
    openApptModalWith(a);  // uses the second modal (#apptModal with <form id="apptForm">)
  });
}

tbody.appendChild(tr);return {__tr:tr,created:(a.created_at||"").slice(0,10),customer:`${a.customer_first} ${a.customer_last}`,vehicle:a.vehicle,service:a.service,date:a.preferred_date||"",time:a.preferred_time||"",status:a.status||"new"};});document.querySelectorAll("#apptTable thead th").forEach((th,i)=>{const map=["created","customer","vehicle","service","date","time","status","actions"];th.setAttribute("data-key",map[i]||"");});makeSortable(document.getElementById("apptTable"),()=>rowObjs);}if(byId("apptFilter"))byId("apptFilter").onclick=draw;draw();}
function populateServiceOptions(){
  const dl = document.getElementById('svcOptions');
  if(!dl) return;

  const d   = readLS(LS.data, { settings:{ services:[] } });
  const sid = (currentShop()||{}).id || null;
  const list = (d.settings?.services || []).filter(s => !s.shop_id || s.shop_id === sid);

  // de-dupe by name (case-insensitive)
  const seen = new Set();
  const unique = [];
  list.forEach(s => {
    const key = String(s.name||'').trim().toLowerCase();
    if(!key || seen.has(key)) return;
    seen.add(key);
    unique.push(s);
  });

  dl.innerHTML = "";
  unique.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name || "";
    dl.appendChild(opt);
  });
}


/* ====== REVISED: setupJobs() for clean staff split (Active vs Awaiting Parts) ====== */
function setupJobs(){
  const me=currentUser()||{};
  const shop=currentShop();
  const canAssign=(me.role==="admin"||me.role==="service_writer");
  const users=(readLS(LS.users,[])||[]).filter(u=>u.shop_id===(shop&&shop.id));
  const staffOptions=users.filter(u=>u.role!=="admin").map(u=>({id:u.id,label:`${u.first||""} ${u.last||""}`.trim()||u.email}));
  const store=readLS(LS.data,{appointments:[],jobs:[]});
  const rows=(store.jobs||[]).map(j=>({...j,a:(store.appointments||[]).find(x=>x.id===j.appointment_id)||{}}));

  const tb=document.querySelector("#jobsTable tbody");
  if(!tb) return;

  const awaitTbody=document.querySelector("#awaitTable tbody");
  const awaitEmpty=byId("awaitEmpty");
  const jobsEmpty=byId("jobsEmpty");

  const badge=(st)=>{const map={new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};const c=map[st]||"";return `<span class="badge ${c}">${st}</span>`;};

  // STAFF — split view (keep UI clean; no duplicate headers)
  if(me.role==="staff"){
    const mine=rows.filter(r=>r.assigned_to===me.id);
    const active=mine.filter(r=>r.status==="in_progress" || r.status==="scheduled");
    const awaiting=mine.filter(r=>r.status==="awaiting_parts");

    function renderStaffRow(r){
      const tr=document.createElement("tr");
      const who=users.find(u=>u.id===r.assigned_to);
      const actions=document.createElement("td");

      const sel=document.createElement("select");
      sel.className="cx-status";
      sel.setAttribute("data-job", r.id);
      ["in_progress","awaiting_parts","completed"].forEach(st=>{
        const op=document.createElement("option");
        op.value=st; op.textContent=st; if(r.status===st) op.selected=true;
        sel.appendChild(op);
      });
      sel.addEventListener("change", ()=>{
        const d=readLS(LS.data,{appointments:[],jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i>=0){
          d.jobs[i].status=sel.value;
          // Keep appointment status in sync with job
          const ai=(d.appointments||[]).findIndex(a=>a.id===r.appointment_id);
          if(ai>=0){ d.appointments[ai].status = sel.value; }
          // EDIT #7: when staff marks completed, create/reuse invoice by appointment_id
          if(sel.value==="completed"){
            try{ ensureInvoiceForAppt(r.appointment_id); }catch(_e){}
          }
          // Merge-safe write to avoid clobbering invoices created by ensureInvoiceForAppt
          const __latestJ = readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]});
          __latestJ.jobs = d.jobs;
          __latestJ.appointments = d.appointments || (__latestJ.appointments||[]);
          writeLS(LS.data,__latestJ);
        }
        location.reload();
      });

      const rm=document.createElement("button");
      rm.className="btn danger";
      rm.textContent="Remove";
      rm.addEventListener("click", ()=>{
        const ok=confirm("Remove this job? OK=Delete · Cancel=Unassign");
        const d=readLS(LS.data,{jobs:[]});
        const i=(d.jobs||[]).findIndex(j=>j.id===r.id);
        if(i<0) return;
        if(ok){ d.jobs.splice(i,1); }
        else { d.jobs[i].assigned_to=null; if(d.jobs[i].status!=="completed") d.jobs[i].status="unassigned"; }
        writeLS(LS.data,d); location.reload();
      });

tr.innerHTML=`<td>${r.id}</td>
  <td>${(r.a.customer_first||"?")} ${(r.a.customer_last||"")}</td>
  <td>${r.a.vehicle||""}</td>
  <td>
    <div class="svc-toggle" data-id="${r.a.id || r.appointment_id}">
      <span class="svc-label">${r.a.service || ""}</span>
      <div class="svc-notes hidden">${(r.a.notes || "No notes").toString()}</div>
    </div>
  </td>
  <td>${badge(r.status)}</td>
  <td>${who?`${who.first||""} ${who.last||""}`.trim():"-"}</td>`;
// Toggle notes on Service click (Jobs table, staff rows)
{
  const svcWrap = tr.querySelector(".svc-toggle");
  const notesEl = svcWrap?.querySelector(".svc-notes");
  if (svcWrap && notesEl) {
    svcWrap.addEventListener("click", (e) => {
      e.stopPropagation?.();
      const isOpen = svcWrap.classList.toggle("open");
      notesEl.classList.toggle("hidden", !isOpen);
    });
  }
}

      actions.appendChild(sel); actions.appendChild(rm);
      tr.appendChild(actions);

      return {__tr:tr,id:r.id,customer:`${r.a.customer_first||""} ${r.a.customer_last||""}`,vehicle:r.a.vehicle||"",service:r.a.service||"",status:r.status||"new"};
    }

    // Active table
    tb.innerHTML="";
    const activeRows=active.map(renderStaffRow);
    activeRows.forEach(r=>tb.appendChild(r.__tr));
    if(jobsEmpty) jobsEmpty.textContent = activeRows.length ? "" : "No active jobs.";

    // Awaiting Parts table
    if(awaitTbody){
      awaitTbody.innerHTML="";
      const awaitingRows=awaiting.map(renderStaffRow);
      awaitingRows.forEach(r=>awaitTbody.appendChild(r.__tr));
      if(awaitEmpty) awaitEmpty.textContent = awaitingRows.length ? "" : "No awaiting parts jobs.";
      document.querySelectorAll("#awaitTable thead th").forEach((th,i)=>{
        const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key",map[i]||"");
      });
      makeSortable(document.getElementById("awaitTable"),()=>awaitingRows);
    }

    // Sorting for Active
    document.querySelectorAll("#jobsTable thead th").forEach((th,i)=>{
      const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("jobsTable"),()=>activeRows);
    return;
  }

  // NON-STAFF (unchanged layout/behavior)
   // NON-STAFF (admin / service_writer): split into Active vs Awaiting Parts
  tb.innerHTML = "";
  if (awaitTbody) awaitTbody.innerHTML = "";

  const today = todayISO();
  const visibleRows = rows.filter(r => (
    r.status === "in_progress" ||
    r.status === "awaiting_parts" ||
    (r.status === "scheduled" && (r.a && r.a.preferred_date === today))
  ));

  const activeList   = visibleRows.filter(r => r.status === "in_progress" || (r.status === "scheduled" && (r.a && r.a.preferred_date === today)));
  const awaitingList = visibleRows.filter(r => r.status === "awaiting_parts");

  if (!rows.length) {
    if (jobsEmpty)  jobsEmpty.textContent  = "No jobs available.";
    if (awaitEmpty) awaitEmpty.textContent = "No awaiting parts jobs.";
    return;
  }
  if (jobsEmpty)  jobsEmpty.textContent  = "";
  if (awaitEmpty) awaitEmpty.textContent = "";

  const canClaimForMe = (r) => (!r.assigned_to) && (me.role !== "receptionist");

  function renderRow(r, containerTbody){
    const tr = document.createElement("tr");
    const assignedUser = users.find(u => u.id === r.assigned_to);

    let assignCell = "";
    if (canAssign) {
      const opts = ['<option value="">Unassigned</option>']
        .concat(staffOptions.map(o => `<option value="${o.id}" ${r.assigned_to===o.id?'selected':''}>${o.label}</option>`))
        .join("");
      assignCell = `<select class="assSel" data-job="${r.id}">${opts}</select>`;
    } else {
      assignCell = assignedUser ? `${assignedUser.first||""} ${assignedUser.last||""}`.trim() : "-";
    }

    const canClaim = canClaimForMe(r);
    const isMine   = canAssign; // admin or service_writer

    let actions = `<a class="btn" href="messages.html?appt=${r.a.id||""}">Message</a>`;
    if (canClaim) actions += ` <button class="btn" data-claim="${r.id}">Claim</button>`;
    if (isMine)   actions += ` <button class="btn" data-unassign="${r.id}">Unassign</button>`;
    if (me.role === "admin") actions += ` <button class="btn danger" data-remove="${r.id}">Remove</button>`;
    if (me.role !== "receptionist") actions += ` <button class="btn cx-find" data-find="${r.id}">Find Parts</button>`;

tr.innerHTML = `<td>${r.id}</td>
      <td>${(r.a.customer_first||"?")} ${(r.a.customer_last||"")}</td>
      <td>${r.a.vehicle||""}</td>
      <td>
        <div class="svc-toggle" data-id="${r.a.id || r.appointment_id}">
          <span class="svc-label">${r.a.service || ""}</span>
          <div class="svc-notes hidden">${(r.a.notes || "No notes").toString()}</div>
        </div>
      </td>
      <td>${badge(r.status)}</td>
      <td>${assignCell}</td>
      <td>${actions}</td>`;
// Toggle notes on Service click (Jobs table, non-staff rows)
{
  const svcWrap = tr.querySelector(".svc-toggle");
  const notesEl = svcWrap?.querySelector(".svc-notes");
  if (svcWrap && notesEl) {
    svcWrap.addEventListener("click", (e) => {
      e.stopPropagation?.();
      const isOpen = svcWrap.classList.toggle("open");
      notesEl.classList.toggle("hidden", !isOpen);
    });
  }
}


    if (canAssign) {
      const sel = tr.querySelector(".assSel");
      sel.addEventListener("change", () => {
        const d = readLS(LS.data, { jobs:[] });
        const i = (d.jobs||[]).findIndex(j => j.id === r.id);
        if (i >= 0) { d.jobs[i].assigned_to = sel.value || null; writeLS(LS.data, d); }
      });
    }

    const claimBtn = tr.querySelector("[data-claim]");
    if (claimBtn) {
      claimBtn.addEventListener("click", () => {
        const d = readLS(LS.data, { jobs:[] });
        const i = (d.jobs||[]).findIndex(j => j.id === r.id);
        if (i < 0) return;
        if (d.jobs[i].assigned_to) { alert("Someone already claimed this job."); return; }
        d.jobs[i].assigned_to = me.id; writeLS(LS.data, d); location.reload();
      });
    }

    const unBtn = tr.querySelector("[data-unassign]");
    if (unBtn) {
      unBtn.addEventListener("click", () => {
        const d = readLS(LS.data, { jobs:[] });
        const i = (d.jobs||[]).findIndex(j => j.id === r.id);
        if (i < 0) return;
        d.jobs[i].assigned_to = null; writeLS(LS.data, d); location.reload();
      });
    }

    const rmBtn = tr.querySelector("[data-remove]");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        const d = readLS(LS.data, { jobs:[] });
        d.jobs = (d.jobs||[]).filter(x => x.id !== r.id);
        writeLS(LS.data, d); location.reload();
      });
    }

const findBtn = tr.querySelector('[data-find]');
if (findBtn) {
  findBtn.addEventListener('click', () => {
    openPartsFinder({
      apptId: r.a.id || r.appointment_id,
      vehicle: r.a.vehicle || '',
      vin: (r.a && r.a.vin) || '',        // NEW: forward VIN if the appt has it
      jobId: r.id
    });
  });
}


    containerTbody.appendChild(tr);
    return { __tr: tr, id: r.id, customer: `${r.a.customer_first||""} ${r.a.customer_last||""}`, vehicle: r.a.vehicle, service: r.a.service, status: r.status||"new" };
  }

  // Render Active to #jobsTable
  const activeRows = activeList.map(r => renderRow(r, tb));
  if (jobsEmpty) jobsEmpty.textContent = activeRows.length ? "" : "No active jobs.";

  // Render Awaiting Parts to #awaitTable
  let awaitingRows = [];
  if (awaitTbody) {
    awaitingRows = awaitingList.map(r => renderRow(r, awaitTbody));
    if (awaitEmpty) awaitEmpty.textContent = awaitingRows.length ? "" : "No awaiting parts jobs.";
    document.querySelectorAll("#awaitTable thead th").forEach((th,i)=>{
      const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key", map[i]||"");
    });
    makeSortable(document.getElementById("awaitTable"), () => awaitingRows);
  }

  // Enable sorting for Active
  document.querySelectorAll("#jobsTable thead th").forEach((th,i)=>{
    const map=["id","customer","vehicle","service","status","assigned","actions"]; th.setAttribute("data-key", map[i]||"");
  });
  makeSortable(document.getElementById("jobsTable"), () => activeRows);

}
/* ====== /REVISED setupJobs() ====== */

/* ===== NEW: setupProfile() ===== */
function setupProfile(){
  const u=currentUser();
  if(!u) return;

  // Prefill
  const f=byId("pfFirst"), l=byId("pfLast"), e=byId("pfEmail"), r=byId("pfRole");
  if(f) f.value = u.first || "";
  if(l) l.value = u.last  || "";
  if(e) e.value = u.email || "";
  if(r) r.value = u.role  || "";

  // Buttons / modals
  const emailModal = byId("emailModal");
  const passModal  = byId("passModal");
  const emailBtn   = byId("changeEmailBtn");
  const passBtn    = byId("changePassBtn");
  const closeEmail = byId("closeEmail");
  const closePass  = byId("closePass");
  const saveEmail  = byId("saveEmail");
  const savePass   = byId("savePass");

  function show(el){ el && el.classList.remove("hidden"); }
  function hide(el){ el && el.classList.add("hidden"); }

  emailBtn && emailBtn.addEventListener("click", ()=>show(emailModal));
  passBtn  && passBtn.addEventListener("click",  ()=>show(passModal));
  closeEmail && closeEmail.addEventListener("click", ()=>hide(emailModal));
  closePass  && closePass.addEventListener("click",  ()=>hide(passModal));

  // Change Email flow
  saveEmail && saveEmail.addEventListener("click", ()=>{
    const newEmail = (byId("newEmail")||{}).value?.trim().toLowerCase();
    const curPass  = (byId("curPassForEmail")||{}).value || "";
    const note = byId("emailNotice");
    if(note) note.textContent = "";

    if(!newEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newEmail)){
      if(note) note.textContent = "Enter a valid email address.";
      return;
    }
    const users=readLS(LS.users,[])||[];
    if(users.some(x=>x.email===newEmail)){
      if(note) note.textContent = "That email is already in use.";
      return;
    }
    // re-auth
    if((u.password||"")!==curPass){
      if(note) note.textContent = "Current password is incorrect.";
      return;
    }
    // update user
    const i=users.findIndex(x=>x.id===u.id);
    if(i>=0){
      users[i].email=newEmail;
      writeLS(LS.users,users);
      // keep session in sync
      writeLS(LS.session,{email:newEmail,at:Date.now()});
      if(byId("pfEmail")) byId("pfEmail").value=newEmail;
      if(note) note.textContent = "Email updated successfully.";
      setTimeout(()=>hide(emailModal), 600);
    }
  });

  // Change Password flow
  savePass && savePass.addEventListener("click", ()=>{
    const cur = (byId("curPass")||{}).value || "";
    const npw = (byId("newPass")||{}).value || "";
    const cfm = (byId("confPass")||{}).value || "";
    const note = byId("passNotice");
    if(note) note.textContent = "";

    if((u.password||"")!==cur){
      if(note) note.textContent = "Current password is incorrect.";
      return;
    }
    if(!npw || npw.length<6){
      if(note) note.textContent = "New password must be at least 6 characters.";
      return;
    }
    if(npw===cur){
      if(note) note.textContent = "New password must be different from current.";
      return;
    }
    if(npw!==cfm){
      if(note) note.textContent = "New password and confirm do not match.";
      return;
    }
    const users=readLS(LS.users,[])||[];
    const i=users.findIndex(x=>x.id===u.id);
    if(i>=0){
      users[i].password=npw;
      writeLS(LS.users,users);
      if(note) note.textContent = "Password updated successfully.";
      setTimeout(()=>hide(passModal), 600);
    }
  });
}

// === Settings helpers (match your existing LS patterns) ===
function _getData(){
  return readLS(LS.data, { settings:{ services:[] }, appointments:[], jobs:[], threads:[], invoices:[] });
}
function _setData(d){
  writeLS(LS.data, d || {});
}
function _curShopId(){
  const s = currentShop();
  return s ? s.id : null;
}

function setupSettings(){
  const addBtn = byId("svcAdd");
  const nameI  = byId("svcName");
  const priceI = byId("svcPrice");
  const listEl = byId("svcList");
const rateList  = byId("rateList");
const rateName  = byId("rateName");
const ratePrice = byId("ratePrice");
const rateAdd   = byId("rateAdd");

  // Safe getters around your existing LS helpers
  function getData(){
    // Ensure object shape so first add never crashes
    return readLS(LS.data, { settings: { services: [] } });
  }
  function saveData(d){ writeLS(LS.data, d); }

  function render(){
    if(!listEl) return;
    const d   = getData();
    const sid = (currentShop()||{}).id || null;
    const all = (d.settings && d.settings.services) || [];
    const rows = all.filter(s => !s.shop_id || s.shop_id === sid);

    listEl.innerHTML = "";
    if(!rows.length){
      const p = document.createElement("p");
      p.className = "notice";
      p.textContent = "No services added yet.";
      listEl.appendChild(p);
      return;
    }

    rows.forEach((svc, idxForShop) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${svc.name} ($${fmtMoney(svc.parts_price||0)})`;
      chip.title = "Click to remove";
  chip.addEventListener("click", ()=>{
  if(!confirm(`Remove service "${svc.name}"?`)) return;

  const d2 = getData();
  const sid2 = (currentShop()||{}).id || null;

  let seen = -1;
  d2.settings.services = (d2.settings.services || []).filter(s => {
    const isMine = (!s.shop_id && sid2 === null) || s.shop_id === sid2;
    if (!isMine) return true;           // keep other shops' services

    // count every service for this shop in order
    seen++;
    return seen !== idxForShop;         // drop the clicked one
  });

  saveData(d2);
  render();
});
// ===== Manage Labor Rates (row-by-row) =====
const labList = byId("labList");
const labAdd  = byId("labAdd");

function labRender(){
  if(!labList) return;

  const d   = getData();
  const sid = (currentShop()||{}).id || null;
  const all = (d.settings && d.settings.labor_rates) || [];

  // map visible rows to their real array index
  const pairs = [];
  all.forEach((r, i) => {
    if(!r) return;
    if(r.shop_id && r.shop_id !== sid) return;
    pairs.push({ r, idx: i });
  });

  labList.innerHTML = "";
  if(!pairs.length){
    const p = document.createElement("p");
    p.className = "notice";
    p.textContent = "No labor rates yet.";
    labList.appendChild(p);
    return;
  }

  pairs.forEach(({ r, idx }) => {
    const row = document.createElement("div");
    row.className = "grid cols-3";
    row.style.marginTop = "8px";

    // Name
    const nameI = document.createElement("input");
    nameI.placeholder = "Rate name (e.g., Standard)";
    nameI.value = r.name || "";

    // $/hr
    const rateI = document.createElement("input");
    rateI.type = "number"; rateI.step = "0.01";
    rateI.placeholder = "0";
    rateI.value = Number(r.rate || 0);

    // Actions
    const acts = document.createElement("div");
    acts.className = "toolbar";

    const saveB = document.createElement("button");
    saveB.className = "btn primary";
    saveB.textContent = "Save";
    saveB.addEventListener("click", ()=>{
      const d2 = getData();
      d2.settings = d2.settings || {};
      d2.settings.labor_rates = d2.settings.labor_rates || [];
      const name = String(nameI.value||"").trim();
      const rate = Number(rateI.value||0);
      if(!name){ alert("Rate name is required."); return; }
      if(isNaN(rate) || rate < 0){ alert("Enter a valid non-negative hourly rate."); return; }
      d2.settings.labor_rates[idx] = {
        ...(d2.settings.labor_rates[idx] || {}),
        name, rate, shop_id: sid, updated_at: new Date().toISOString()
      };
      saveData(d2);
      labRender();
    });

    const rmB = document.createElement("button");
    rmB.className = "btn danger";
    rmB.textContent = "Remove";
    rmB.addEventListener("click", ()=>{
      if(!confirm(`Remove rate "${r.name||""}"?`)) return;
      const d2 = getData();
      d2.settings = d2.settings || {};
      d2.settings.labor_rates = d2.settings.labor_rates || [];
      if(idx >= 0 && idx < d2.settings.labor_rates.length){
        d2.settings.labor_rates.splice(idx, 1);
      }
      saveData(d2);
      labRender();
    });

    acts.appendChild(saveB);
    acts.appendChild(rmB);
    row.appendChild(nameI);
    row.appendChild(rateI);
    row.appendChild(acts);
    labList.appendChild(row);
  });
}

if (labAdd && !labAdd.dataset.bound) {
  labAdd.dataset.bound = "1";         // <-- one-time guard
  labAdd.addEventListener("click", ()=>{
    const d   = getData();
    const sid = (currentShop()||{}).id || null;
    d.settings = d.settings || {};
    d.settings.labor_rates = d.settings.labor_rates || [];
    d.settings.labor_rates.push({
      name: "", rate: 0, shop_id: sid, created_at: new Date().toISOString()
    });
    saveData(d);
    labRender();                       // your existing redraw
  });
}


// draw once on load
labRender();
// ===== /Manage Labor Rates =====

      listEl.appendChild(chip);
    });
  }

  if(addBtn){
    addBtn.addEventListener("click", ()=>{
      const name  = (nameI && nameI.value || "").trim();
      const price = Number(priceI && priceI.value || 0);
      if(!name){ alert("Service name is required."); return; }
      if(isNaN(price) || price < 0){ alert("Enter a valid non-negative price."); return; }

      const d = getData();
      d.settings = d.settings || {};
      d.settings.services = d.settings.services || [];
      d.settings.services.push({
        name,
        parts_price: price,
        shop_id: (currentShop()||{}).id || null
      });
      saveData(d);

      if(nameI) nameI.value = "";
      if(priceI) priceI.value = "";
      render();
    });
  }

  render();
}





function setupMessages(){const store=readLS(LS.data,{threads:[],appointments:[]});if(!(readLS("xm_inquiry_seeded",false))){const hasInquiry=(store.threads||[]).some(t=>t.type==="inquiry");if(!hasInquiry){(store.threads=store.threads||[]).push({id:"t"+Date.now(),type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}]});writeLS("xm_inquiry_seeded",true);writeLS(LS.data,store);}}const data=readLS(LS.data,{threads:[],appointments:[]});const list=byId("threadList");const chat=byId("chatBox");const title=byId("threadTitle");const form=byId("sendForm");const inp=byId("msgInput");function renderList(){if(!list)return;list.innerHTML="";(data.threads||[]).slice().reverse().forEach(t=>{const li=document.createElement("li");li.style.padding="8px";li.style.borderBottom="1px solid var(--line)";li.tabIndex=0;const badge=t.type==="inquiry"?'<span class="badge open" style="margin-left:8px">New Inquiry</span>':"";const last=(t.messages||[])[(t.messages||[]).length-1]||{body:""};li.innerHTML=`<b>${t.title||("Appt "+(t.appointment_id||""))}</b> ${badge}<div class="notice">${last.body||""}</div>`;li.addEventListener("click",()=>select(t.id));list.appendChild(li);});}function renderMessages(t){return `<div style="margin-top:10px">${(t.messages||[]).map(m=>`<div style="margin:6px 0"><span class="badge ${m.from==='staff'?'scheduled':'open'}">${m.from}</span> ${m.body}</div>`).join("")}</div>`;}let cur=null;function select(id){const t=(data.threads||[]).find(x=>x.id===id);if(!t)return;title.textContent=t.title||("Appt "+(t.appointment_id||""));chat.innerHTML=renderMessages(t);chat.scrollTop=chat.scrollHeight;cur=t;}renderList();if(form)form.addEventListener("submit",(e)=>{e.preventDefault();const body=inp.value.trim();if(!body||!cur)return;cur.messages=cur.messages||[];cur.messages.push({from:"staff",body,created_at:new Date().toISOString()});const d=readLS(LS.data,{});const i=(d.threads||[]).findIndex(x=>x.id===cur.id);if(i>=0){d.threads[i]=cur;writeLS(LS.data,d);}inp.value="";select(cur.id);});}

function setupInvoices(){
  if (setupInvoices._wired) return;
  setupInvoices._wired = true;
  const data=readLS(LS.data,{invoices:[],appointments:[]});
  const tb=document.querySelector("#invTable tbody");
  const empty=document.getElementById("invEmpty");
  const pbody=document.querySelector("#prevTable tbody");
  const pempty=document.getElementById("prevEmpty");

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
// --- Wire prefill on invoice load (inside invoice init) ---
try{
  const url = new URL(window.location.href);
  const apptId = url.searchParams.get("appt");
  if(apptId){
const appts = (readLS(LS.data, { appointments: [] }).appointments) || [];
    const appt = appts.find(a=>String(a.id)===String(apptId));
    if(appt) prefillInvoiceFromAppointment(appt);
  }
}catch(e){ console.warn("Appt→Invoice prefill skipped:", e); }

  // track edit state
  let invEditingId = null;

  function fmt(n){return Number(n||0).toFixed(2);}
  function total(inv){
    const sub=(inv.items||[]).reduce((s,x)=>s+(Number(x.qty)||0)*(Number(x.price)||0),0);
    const tax=sub*((Number(inv.tax_rate)||0)/100);
    const disc=sub*((Number(inv.discount)||0)/100);
    return {sub,total:sub+tax-disc};
  }
  function badge(st){
    const map={open:"open",paid:"done",new:"open",scheduled:"scheduled",in_progress:"progress",awaiting_parts:"parts",completed:"done"};
    const c=map[st]||"";
    return `<span class="badge ${c}">${st}</span>`;
  }

  function render(){
    const q=(document.getElementById("invSearch")?.value||"").toLowerCase().trim();
    const opens=(data.invoices||[]).filter(i=>(i.status||"open")!=="paid");
    tb.innerHTML="";
    const openRows=opens
      .filter(inv=>{
        const hay=`${inv.number||inv.id} ${inv.customer||""} ${inv.appointment_id||""}`.toLowerCase();
        return !q||hay.includes(q);
      })
      .map(inv=>{
        const t=total(inv);
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td><a href="invoice.html?id=${inv.number||inv.id}" class="btn">${inv.number||inv.id}</a></td>
          <td>${inv.customer||"-"}</td>
          <td>$${fmt(t.total)}</td>
          <td>${badge(inv.status||"open")}</td>
          <td>${inv.due||""}</td>
          <td>
            <button class="btn edit-inv">Edit</button>
            <button class="btn mark-paid">Mark Paid</button>
            <button class="btn danger" data-remove="${inv.id}">Remove</button>
          </td>`;

        tr.querySelector(".edit-inv").addEventListener("click",()=>editInvoice(inv.id));
        tr.querySelector(".mark-paid").addEventListener("click",()=>{
          inv.status="paid"; writeLS(LS.data,data); render();
        });
        tr.querySelector('[data-remove]').addEventListener('click',()=>{
          const idx=data.invoices.findIndex(x=>x.id===inv.id);
          if(idx>-1){ data.invoices.splice(idx,1); writeLS(LS.data,data); render(); }
        });

        tb.appendChild(tr);
        return {__tr:tr,num:(inv.number||inv.id),customer:(inv.customer||"-"),total:t.total,status:(inv.status||"open"),due:(inv.due||"")};
      });

    const pq=(document.getElementById("prevSearch")?.value||"").toLowerCase().trim();
    const paids=(data.invoices||[]).filter(i=>(i.status||"open")==="paid");
    pbody.innerHTML="";
    const paidRows=paids
      .filter(inv=>{
        const hay=`${inv.number||inv.id} ${inv.customer||""} ${inv.appointment_id||""}`.toLowerCase();
        return !pq||hay.includes(pq);
      })
      .map(inv=>{
        const t=total(inv);
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td><a href="invoice.html?id=${inv.number||inv.id}" class="btn">${inv.number||inv.id}</a></td>
          <td>${inv.customer||"-"}</td>
          <td>$${fmt(t.total)}</td>
          <td>${badge("paid")}</td>
          <td>${inv.due||""}</td>
          <td>
            <button class="btn edit-inv">Edit</button>
            <button class="btn danger" data-remove="${inv.id}">Remove</button>
          </td>`;

        tr.querySelector(".edit-inv").addEventListener("click",()=>editInvoice(inv.id));
        tr.querySelector('[data-remove]').addEventListener('click',()=>{
          const idx=data.invoices.findIndex(x=>x.id===inv.id);
          if(idx>-1){ data.invoices.splice(idx,1); writeLS(LS.data,data); render(); }
        });

        pbody.appendChild(tr);
        return {__tr:tr,num:(inv.number||inv.id),customer:(inv.customer||"-"),total:t.total,status:"paid",due:(inv.due||"")};
      });

    document.querySelectorAll("#invTable thead th").forEach((th,i)=>{
      const map=["num","customer","total","status","due","actions"];
      th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("invTable"),()=>openRows);

    document.querySelectorAll("#prevTable thead th").forEach((th,i)=>{
      const map=["num","customer","total","status","due","actions"];
      th.setAttribute("data-key",map[i]||"");
    });
    makeSortable(document.getElementById("prevTable"),()=>paidRows);

    empty&&(empty.textContent=openRows.length?"":"No open/unpaid invoices.");
    pempty&&(pempty.textContent=paidRows.length?"":"No paid invoices yet.");
  }

  function openModal(newMode=true){
    modal?.classList.remove("hidden");
    if(newMode){
      invEditingId = null;
      itemsDiv&&(itemsDiv.innerHTML="");
      if(taxI)taxI.value=6;
      if(discI)discI.value=0;
      if(dueI)dueI.value=todayISO();
      if(custI)custI.value="";
      if(apptI)apptI.value="";
      addItem();
      calc();
      const title=document.getElementById("invTitle"); if(title) title.textContent="New Invoice";
    }
  }
  function closeModal(){ modal?.classList.add("hidden"); }

function addItem(name="", qty=1, price=0){
  const wrap=document.createElement("div");
  wrap.className="grid cols-3";
  wrap.style.marginTop="6px";
  wrap.innerHTML=`
    <input placeholder="Name" class="itm-name" value="${name}">
    <input type="number" placeholder="Qty" value="${qty}" class="itm-qty">
    <input type="number" placeholder="Price" value="${price}" class="itm-price">
    <button type="button" class="btn danger itm-remove">Remove</button>`;
  itemsDiv.appendChild(wrap);

  // hook up remove
  wrap.querySelector(".itm-remove").addEventListener("click",()=>{
    wrap.remove();
    calc();
  });
}
// --- Prefill engine (right under addItem) ---
function prefillInvoiceFromAppointment(appt){
  if(!appt||!appt.id) return;
  const guardKey=_apptPrefillKey(appt.id);
  if(sessionStorage.getItem(guardKey)) return; // only once per appt

  const sid = appt.service_id || appt.service || appt.svc_id;
  const sname = appt.service_name || appt.serviceLabel || appt.service;

  const svc = getServiceConfigById(sid) || getServiceConfigByName(sname);
  const label = `Labor - ${svc?.name || sname || "Service"}`;
const rate   = Number(svc?.rate || 0);
const hours  = Number(svc?.hours || 0);
// Prefer base-price services; fallback to labor math
const base   = Number(svc?.price ?? svc?.base_price ?? 0);
const price  = Number.isFinite(base) && base > 0 ? base : (rate * hours);


  // prevent duplicate by label if user already added it
  try{
    const existing = document.querySelectorAll(".itm-name");
    for(const el of existing){
      if(String(el.value||"").trim().toLowerCase()===label.toLowerCase()) return;
    }
  }catch(e){}

  // use your exact addItem implementation
  if(typeof addItem==="function") addItem(label, 1, price);

  try{ if(typeof calc==="function") calc(); }catch(e){}
  try{ if(typeof saveDraft==="function") saveDraft(); }catch(e){}

  sessionStorage.setItem(guardKey,"1");
}

/* =========================
   INVOICE NAME ENHANCER v2
   - Keeps addItem() & row UI identical.
   - "Name" gets a datalist (dropdown) with Parts/Labor.
   - Choosing Parts shows a tiny inline form to enter the part name -> sets Name to "Part:XXXX".
   - Choosing Labor shows a tiny inline form with:
       • Saved Rate (dropdown)
       • Rate (typeable)
       • Hours
     -> Price = rate * hours, Name like "Labor - <label> for Xh".
========================= */

// Read saved labor rates safely
function _getSavedLaborRatesSafe() {
  try {
    const d = (typeof _getData === "function") ? _getData()
            : (typeof readLS === "function" ? (readLS("crm_data") || {}) : {}) || {};
    const s = d.settings || {};
    let list = [];
    if (Array.isArray(s.laborRates)) list = s.laborRates;
    else if (Array.isArray(s.labor_rates)) list = s.labor_rates;
    else if (s.labor && Array.isArray(s.labor.rates)) list = s.labor.rates;

    return list.map(r => {
      const label = r.label || r.name || r.title || `${Number(r.rate ?? r.value ?? 0).toFixed(2)}`;
      const rate  = Number(r.rate ?? r.value ?? r.amount ?? 0) || 0;
      return { label, rate };
    });
  } catch { return []; }
}

// One datalist for "Name" input → dropdown for Parts/Labor
function _ensureTypeDatalist() {
  let dl = document.getElementById("itm-type-list");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "itm-type-list";
    dl.innerHTML = `<option value="Parts"><option value="Labor">`;
    document.body.appendChild(dl);
  }
  return dl;
}

// Small popover factory (inline styles so we don't touch your CSS files)
function _makePopover(anchor, html) {
  // close any existing one on this row first
  anchor.closest(".grid")?.querySelectorAll(".inv-popover").forEach(el=>el.remove());

  const pop = document.createElement("div");
  pop.className = "inv-popover";
  pop.style.cssText = `
    position: absolute; z-index: 9999; background: #111; color:#fff; border:1px solid #333;
    border-radius:8px; padding:10px; box-shadow:0 6px 18px rgba(0,0,0,.35);
    width: min(320px, 90vw);
  `;

  // position next to the Name input
  const r = anchor.getBoundingClientRect();
  const scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  pop.style.left = (r.left + scrollLeft) + "px";
  pop.style.top  = (r.bottom + scrollTop + 6) + "px";

  pop.innerHTML = html;
  document.body.appendChild(pop);

  function close() { pop.remove(); }
  // ESC closes
  const onKey = (e)=>{ if(e.key==="Escape") close(); };
  document.addEventListener("keydown", onKey, { once:true });
  // Click outside closes
  setTimeout(()=>{
    function outside(e){
      if (!pop.contains(e.target)) { close(); document.removeEventListener("mousedown", outside); }
    }
    document.addEventListener("mousedown", outside);
  },0);

  return pop;
}

function setupInvoiceSmartNameInputV2() {
  // Give the Name input a real dropdown (datalist) for Parts/Labor
  document.addEventListener("focusin", (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement)) return;
    if (!inp.classList.contains("itm-name")) return;
    _ensureTypeDatalist();
    if (!inp.hasAttribute("list")) inp.setAttribute("list", "itm-type-list");
    inp.setAttribute("autocomplete", "off");
  });

  // Handle choosing "Parts" or "Labor" from that dropdown
  document.addEventListener("change", (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement)) return;
    if (!inp.classList.contains("itm-name")) return;

    const v = String(inp.value||"").trim().toLowerCase();
    const wrap = inp.closest(".grid.cols-3") || inp.closest(".grid");
    if (!wrap) return;

    const qtyEl   = wrap.querySelector(".itm-qty");
    const priceEl = wrap.querySelector(".itm-price");
    const safeCalc = () => { try { calc(); } catch {} };

    if (v === "parts") {
      // Inline mini-form for part name → Name becomes "Part:XXXX"
      const pop = _makePopover(inp, `
        <div style="display:grid; gap:8px;">
          <label style="font-size:12px; opacity:.85;">Part name</label>
          <input type="text" class="pp-partname" placeholder="e.g., Brake Pads" style="padding:8px; border-radius:6px; border:1px solid #454545; background:#1a1a1a; color:#fff;">
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button type="button" class="pp-cancel" style="padding:6px 10px; border-radius:6px; background:#333; color:#fff; border:1px solid #444;">Cancel</button>
            <button type="button" class="pp-apply"  style="padding:6px 10px; border-radius:6px; background:#0b84ff; color:#fff; border:0;">Apply</button>
          </div>
        </div>
      `);
      const nameInput = pop.querySelector(".pp-partname");
      nameInput.focus();

      pop.querySelector(".pp-cancel").onclick = ()=> pop.remove();
      pop.querySelector(".pp-apply").onclick = ()=>{
        const partName = (nameInput.value||"").trim();
        inp.value = partName ? `Part:${partName}` : "";
        pop.remove();
        safeCalc();
      };
      return;
    }

    if (v === "labor") {
      // Inline mini-form for labor with dropdown + typeable rate + hours
      const rates = _getSavedLaborRatesSafe(); // [{label,rate}]
      const opts = ['<option value="">Select saved rate</option>']
        .concat(rates.map((r,i)=>`<option value="${Number(r.rate)}">${(r.label||"Rate")} ($${Number(r.rate).toFixed(2)}/hr)</option>`))
        .join("");

      const pop = _makePopover(inp, `
        <div style="display:grid; gap:8px;">
          <label style="font-size:12px; opacity:.85;">Saved Rate</label>
          <select class="pp-rate-sel" style="padding:8px; border-radius:6px; border:1px solid #454545; background:#1a1a1a; color:#fff;">
            ${opts}
          </select>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
              <label style="font-size:12px; opacity:.85;">Rate ($/hr)</label>
              <input type="number" step="0.01" min="0" class="pp-rate" placeholder="e.g., 120"
                     style="padding:8px; border-radius:6px; border:1px solid #454545; background:#1a1a1a; color:#fff;">
            </div>
            <div>
              <label style="font-size:12px; opacity:.85;">Hours</label>
              <input type="number" step="0.1" min="0" class="pp-hours" placeholder="e.g., 1.5"
                     style="padding:8px; border-radius:6px; border:1px solid #454545; background:#1a1a1a; color:#fff;">
            </div>
          </div>

          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
            <button type="button" class="pp-cancel" style="padding:6px 10px; border-radius:6px; background:#333; color:#fff; border:1px solid #444;">Cancel</button>
            <button type="button" class="pp-apply"  style="padding:6px 10px; border-radius:6px; background:#0b84ff; color:#fff; border:0;">Apply</button>
          </div>
        </div>
      `);

      const sel   = pop.querySelector(".pp-rate-sel");
      const rateI = pop.querySelector(".pp-rate");
      const hrsI  = pop.querySelector(".pp-hours");

      sel.onchange = ()=>{ if(sel.value) rateI.value = sel.value; };

      pop.querySelector(".pp-cancel").onclick = ()=> pop.remove();
      pop.querySelector(".pp-apply").onclick = ()=>{
        const rate  = Number(rateI.value||sel.value||0) || 0;
        const hours = Number(hrsI.value||0) || 0;
        if (qtyEl)   qtyEl.value = "1"; // labor lines quantity = 1
        if (priceEl) priceEl.value = (rate * hours).toFixed(2);

        // Name like "Labor - <label> for Xh"
        let label = "";
        if (sel && sel.selectedIndex > 0) {
          label = (rates[sel.selectedIndex-1]?.label) || "";
        } else if (rate) {
          label = "Custom";
        }
        const parts = ["Labor"];
        if (label) parts.push(`- ${label}`);
        if (hours) parts.push(`for ${hours}h`);
        inp.value = parts.join(" ");

        pop.remove();
        safeCalc();
      };

      // focus first control
      (sel.options.length>1 ? sel : rateI).focus();
      return;
    }
  });

  // Bonus: If they *type* "parts" and press Enter → open the parts mini-form directly
  document.addEventListener("keydown", (e)=>{
    const inp = e.target;
    if (e.key !== "Enter") return;
    if (!(inp instanceof HTMLInputElement)) return;
    if (!inp.classList.contains("itm-name")) return;
    const v = String(inp.value||"").trim().toLowerCase();
    if (v === "parts") {
      // trigger change flow to open the parts popover
      inp.dispatchEvent(new Event("change", {bubbles:true}));
      e.preventDefault();
    }
  });
}

// init once
setupInvoiceSmartNameInputV2();


  function collect(){
    return Array.from(itemsDiv.querySelectorAll(".grid")).map(r=>({
      name:r.querySelector(".itm-name").value||"Item",
      qty:Number(r.querySelector(".itm-qty").value||0),
      price:Number(r.querySelector(".itm-price").value||0)
    }));
  }
  function calc(){
    const items=collect();
    const sub=items.reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
    const tax=sub*((Number(taxI?.value)||0)/100);
    const disc=sub*((Number(discI?.value)||0)/100);
    subEl&&(subEl.textContent=Number(sub).toFixed(2));
    grandEl&&(grandEl.textContent=Number(sub+tax-disc).toFixed(2));
  }

  function editInvoice(id){
    const inv=(data.invoices||[]).find(i=>i.id===id);
    if(!inv) return;
    invEditingId = id;
    // Prefill
    if(custI) custI.value = inv.customer || "";
    if(apptI) apptI.value = inv.appointment_id || "";
    if(taxI) taxI.value = Number(inv.tax_rate||0);
    if(discI) discI.value = Number(inv.discount||0);
    if(dueI) dueI.value = inv.due || todayISO();
    if(itemsDiv){
      itemsDiv.innerHTML="";
      (inv.items||[]).forEach(it=>{
        addItem();
        const last = itemsDiv.querySelectorAll(".grid").item(itemsDiv.querySelectorAll(".grid").length-1);
        last.querySelector(".itm-name").value = it.name || "Item";
        last.querySelector(".itm-qty").value = Number(it.qty||0);
        last.querySelector(".itm-price").value = Number(it.price||0);
      });
    }
    calc();
    const title=document.getElementById("invTitle"); if(title) title.textContent="Edit Invoice";
    openModal(false);
  }

  openBtn&&openBtn.addEventListener("click",()=>openModal(true));
  closeBtn&&closeBtn.addEventListener("click",closeModal);
  addBtn&&addBtn.addEventListener("click",()=>{ addItem(); calc(); });
  itemsDiv&&itemsDiv.addEventListener("input",calc);
  taxI&&taxI.addEventListener("input",calc);
  discI&&discI.addEventListener("input",calc);

  function validateBeforeSave(items){
    // must have at least one item with qty>0
    const validItem = items.some(it => (Number(it.qty)||0) > 0);
    if(!validItem){ alert("Invoice must have at least one item with quantity > 0."); return false; }
    return true;
  }

  const saveBtnHandler=()=>{
    const items=collect();
    if(!validateBeforeSave(items)) return;

    if(invEditingId){
      // update existing
      const idx=(data.invoices||[]).findIndex(i=>i.id===invEditingId);
      if(idx>=0){
        const inv=data.invoices[idx];
        inv.customer = custI?(custI.value||"Walk-in"):"Walk-in";
        inv.appointment_id = apptI?(apptI.value||null):null;
        inv.tax_rate = Number(taxI?.value||0)||0;
        inv.discount = Number(discI?.value||0)||0;
        inv.due = dueI?(dueI.value||todayISO()):todayISO();
        inv.items = items;
        // number & status remain as-is (edited elsewhere)
        writeLS(LS.data,data);
      }
      closeModal();
      render();
      invEditingId=null;
      return;
    }

    // create new
    const next=(data.invoices||[]).reduce((mx,i)=>Math.max(mx,Number(i.number||0)||0),1000)+1;
    const inv={
      id:"inv"+Date.now(),
      number:String(next),
      customer:custI?(custI.value||"Walk-in"):"Walk-in",
      appointment_id:apptI?(apptI.value||null):null,
      status:"open",
      due:dueI?(dueI.value||todayISO()):todayISO(),
      tax_rate:Number(taxI?.value||0)||0,
      discount:Number(discI?.value||0)||0,
      items
    };
    data.invoices.push(inv);
    writeLS(LS.data,data);
    closeModal();
    render();
  };

  // Rebind save each render
  if(saveBtn){
    const clone = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(clone, saveBtn);
    clone.id = "saveInv"; // keep same id
    clone.addEventListener("click", saveBtnHandler);
  }

  const apptQ=new URLSearchParams(location.search).get("appt");
  if(apptQ){
    let inv=(data.invoices||[]).find(i=>i.appointment_id===apptQ);
    if(!inv){
      const appt=(data.appointments||[]).find(a=>a.id===apptQ);
      const next=(data.invoices||[]).reduce((mx,i)=>Math.max(mx,Number(i.number||0)||0),1000)+1;
      inv={id:"inv"+Date.now(),number:String(next),customer:appt?`${appt.customer_first||""} ${appt.customer_last||""}`.trim()||"Walk-in":"Walk-in",appointment_id:apptQ,status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Item",qty:1,price:0}]};
      data.invoices.push(inv); writeLS(LS.data,data);
    }
    location.replace(`invoice.html?id=${inv.number||inv.id}`);
    return;
  }

  document.getElementById("invSearch")?.addEventListener("input",render);
  document.getElementById("prevSearch")?.addEventListener("input",render);
  render();
}

document.addEventListener("click",(e)=>{if(e.target&&e.target.id==="pfSave"){const u=currentUser();if(!u)return;const users=readLS(LS.users,[]);const i=users.findIndex(x=>x.id===u.id);if(i>=0){users[i].first=(byId("pfFirst")||{}).value||users[i].first;users[i].last=(byId("pfLast")||{}).value||users[i].last;writeLS(LS.users,users);const note=byId("pfSaved");if(note)note.textContent="Saved.";}}});

/* ===== Existing non-invasive Job Claim enhancer (kept 1:1) ===== */
(async function(){
  await (async function(){
    if(readLS(LS.seeded,false)) return;
    writeLS(LS.users,[{id:"u1",first:"Owner",last:"User",email:"owner@xpose.test",password:"admin123",role:"admin",shop_id:"s1"}]);
    writeLS(LS.shops,[{id:"s1",name:"Xpose Management",type:"Mechanic",join_code:"ABCD12",staff_limit:3}]);
    writeLS(LS.data,{
      settings:{ shop:{ name:"Xpose Management", phone:"", email:"" } },
      appointments:[{id:"a1",created_at:new Date().toISOString(),customer_first:"Evan",customer_last:"Ramos",email:"evan.ramos@example.com",phone:"(301) 555-0182",vehicle:"2014 BMW 335i",service:"Brake inspection",preferred_date:todayISO(),preferred_time:"10:00",status:"scheduled",source:"inquiry",shop_id:"s1"}],
      jobs:[{id:"J1001",appointment_id:"a1",status:"scheduled",shop_id:"s1"}],
      threads:[{id:"t1",type:"inquiry",title:"New Inquiry · Evan Ramos",meta:{name:"Evan Ramos",phone:"(301) 555-0182",email:"evan.ramos@example.com",vehicle:"2014 BMW 335i",service:"Brake inspection",date:todayISO(),time:"10:00",notes:"Grinding noise on front left."},messages:[{from:"system",body:"New inquiry submitted from website.",created_at:new Date().toISOString()}],shop_id:"s1"}],
      invoices:[{id:"inv1001",number:"1001",customer:"Evan Ramos",appointment_id:"a1",status:"open",due:todayISO(),tax_rate:6,discount:0,items:[{name:"Labor",qty:1,price:120},{name:"Parts",qty:1,price:45}],shop_id:"s1"}]
    });
    writeLS(LS.seeded,true);
  })();

  // continue app init
  setThemeFromUser();
  if(byId("themeToggle"))byId("themeToggle").addEventListener("click",toggleTheme);
  if(byId("logoutBtn"))byId("logoutBtn").addEventListener("click",logout);
  const p=pageName();
  if(p==="index"||p==="")setupLogin();
  else{ requireAuth(); if(p==="dashboard")setupDashboard(); if(p==="appointments")setupAppointments(); if(p==="jobs")setupJobs(); if(p==="messages")setupMessages(); if(p==="invoices")setupInvoices(); if(p==="profile")setupProfile(); }

})();
/* ===== EDIT: Job Claim flow (non-invasive, additive) ===== */
// Tiny helpers (reuse your LS + data shapes)
function __data(){ return readLS(LS.data,{appointments:[],jobs:[],threads:[],invoices:[]}); }
function __save(d){ writeLS(LS.data,d); }
function __jobForAppt(apptId){
  const d=__data();
  let j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
  if(!j){ j={id:"J"+Date.now(), appointment_id:apptId, status:"unassigned"}; d.jobs=d.jobs||[]; d.jobs.push(j); __save(d); }
  return j;
}
function __assign(jobId, userId){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return false;
  if(d.jobs[i].assigned_to && d.jobs[i].assigned_to!==userId) return false;
  d.jobs[i].assigned_to=userId;
  if(d.jobs[i].status!=='completed') d.jobs[i].status='in_progress';
  __save(d); return true;
}
function __unassign(jobId){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return;
  d.jobs[i].assigned_to=null;
  if(d.jobs[i].status!=='completed') d.jobs[i].status='unassigned';
  __save(d);
}
function __delJob(jobId){
  const d=__data(); d.jobs=(d.jobs||[]).filter(x=>x.id!==jobId); __save(d);
}
function __setStatus(jobId, status){
  const d=__data(); const i=(d.jobs||[]).findIndex(x=>x.id===jobId);
  if(i<0) return; d.jobs[i].status=status; __save(d);
}

// Enhance rendered tables without touching your templates
function __claimEnhance(){
  try{
    if (typeof currentUser !== "function") return;
    const me = currentUser();
    if(!me) return;

    // DASHBOARD: Day table (find appt id from action links)
    const dayTbody = document.querySelector("#dayTable tbody");
    if(dayTbody){
      dayTbody.querySelectorAll("tr").forEach(tr=>{
        const actions = tr.querySelector("td:last-child");
        if(!actions || actions.querySelector(".cx-claim")) return;
        const link = actions.querySelector('a[href*="messages.html?appt="], a[href*="invoices.html?appt="]');
        if(!link) return;
        let apptId = null;
        try { apptId = new URL(link.getAttribute("href"), location.href).searchParams.get("appt"); } catch(_e){}
        if(!apptId) return;
        const d=__data(); const j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
        const claimable = (!j || !j.assigned_to);
        if(me.role==='staff' && claimable){
          const btn=document.createElement("button");
          btn.className="btn cx-claim";
          btn.textContent="Claim";
          btn.addEventListener("click", ()=>{
            const jj=__jobForAppt(apptId);
            if(jj.assigned_to && jj.assigned_to!==me.id){ alert("This job is already assigned."); return; }
            __assign(jj.id, me.id);
            location.reload();
          });
          actions.appendChild(btn);
        }
      });
    }

    // APPOINTMENTS: add Claim before Remove
    const apptTable = document.getElementById("apptTable") || document.querySelector('[data-app-table="appointments"]');
    const apptBody = apptTable && apptTable.querySelector("tbody");
    if(apptBody){
      apptBody.querySelectorAll("tr").forEach(tr=>{
        const actions = tr.querySelector("td:last-child");
        if(!actions || actions.querySelector(".cx-claim-appt")) return;
        const link = actions.querySelector('a[href*="messages.html?appt="], a[href*="invoices.html?appt="]');
        if(!link) return;
        let apptId = null;
        try { apptId = new URL(link.getAttribute("href"), location.href).searchParams.get("appt"); } catch(_e){}
        if(!apptId) return;
        const d=__data(); const j=(d.jobs||[]).find(x=>x.appointment_id===apptId);
        const claimable = (!j || !j.assigned_to);
        if(me.role==='staff' && claimable){
          const btn=document.createElement("button");
          btn.className="btn cx-claim-appt";
          btn.textContent="Claim";
          btn.addEventListener("click", ()=>{
            const jj=__jobForAppt(apptId);
            if(jj.assigned_to && jj.assigned_to!==me.id){ alert("This job is already assigned."); return; }
            __assign(jj.id, me.id);
            location.reload();
          });
          const removeBtn = actions.querySelector("button.btn.danger");
          actions.insertBefore(btn, removeBtn || null);
        }
      });
    }

    // JOBS: hide Claim; for staff on own jobs provide limited controls
    const jobsTable = document.getElementById("jobsTable");
    if(jobsTable){
      // remove any claim buttons
      jobsTable.querySelectorAll("[data-claim]").forEach(el=> el.remove());

      if(me.role==='staff'){
        jobsTable.querySelectorAll("tr").forEach(tr=>{
          const actions = tr.querySelector("td:last-child");
          if(!actions || actions.querySelector(".cx-status")) return;
          const unBtn = actions.querySelector("[data-unassign]");
          const jobId = (unBtn && unBtn.getAttribute("data-unassign")) || null;
          // hide unassign if present; we'll replace with status+remove
          if(unBtn) unBtn.remove();
          if(!jobId) return; // only on own jobs
          const sel = document.createElement("select");
          sel.className="cx-status";
          sel.setAttribute("data-job", jobId);
          ["in_progress","awaiting_parts","completed"].forEach(st=>{
            const op=document.createElement("option"); op.value=st; op.textContent=st; sel.appendChild(op);
          });
          sel.addEventListener("change", ()=>{ __setStatus(jobId, sel.value); location.reload(); });

          const rm=document.createElement("button");
          rm.className="btn danger cx-remove-job";
          rm.textContent="Remove";
          rm.addEventListener("click", ()=>{
            const ok = confirm("Remove this job? Press OK to DELETE, Cancel to UNASSIGN.");
            if(ok){ __delJob(jobId); } else { __unassign(jobId); }
            location.reload();
          });
          actions.appendChild(sel);
          actions.appendChild(rm);
        });
      }
    }
  }catch(e){ /* safe no-op */ }
}
// Run after the page renders (and again when user interacts) without touching existing init
document.addEventListener("DOMContentLoaded", ()=> { setTimeout(__claimEnhance, 0); });
document.addEventListener("click", ()=> { setTimeout(__claimEnhance, 0); });
/* ===== /EDIT ===== */
})();
// ==================== Auto-Labor (Per-Service, Always Add) ====================

// Local getters/setters (do not override your existing getData/setData)
function _getData() {
  try { return JSON.parse(localStorage.getItem('xm_data')||'{}') || {}; }
  catch(e){ return {}; }
}
function _setData(d) {
  localStorage.setItem('xm_data', JSON.stringify(d||{}));
}
function _getUsers() {
  try { return JSON.parse(localStorage.getItem('xm_users')||'[]') || []; }
  catch(e){ return []; }
}
function _getSession() {
  try { return JSON.parse(localStorage.getItem('xm_session')||'null'); }
  catch(e){ return null; }
}
function _curShopId() {
  const s = _getSession();
  if (!s || !s.email) return null;
  const me = _getUsers().find(u => u.email === s.email);
  return me && me.shop_id || null;
}

// Look up service config by name for current shop
function getServiceConfigByName(name) {
  if (!name) return null;
  const d = _getData();
  const list = (d.settings && d.settings.services) || [];
  const lower = String(name).toLowerCase();
  const sid   = _curShopId();
  // Prefer same-shop services; fall back to any if shop_id missing
  const hit = list.find(s =>
    String(s.name||'').toLowerCase() === lower &&
    (!s.shop_id || s.shop_id === sid)
  );
  return hit || null;
}

// Build a labor line even if no config (defaults to $0.00)
// If service has rate & hours => price = rate * hours; else price = 0
function makeLaborItemForServiceAlways(serviceName, partName) {
  // even if no config, create a labor line with $0
  const label = serviceName
    ? `Labor - ${serviceName}`
    : `Labor - ${partName}`;

  let rate = 0, hours = 0;
  const d = _getData();
  const svc = (d.settings?.services || []).find(s => s.name === serviceName);
  if (svc) {
    rate = Number(svc.labor_rate || 0);
    hours = Number(svc.hours || 0);
  }

  return {
    name: label,       // <-- always string, never null
    qty: hours || 0,
    price: rate || 0
  };
}



// (Optional) refresh the chips/list UI here as you already do

// Add a Part and ALWAYS follow with a Labor line (0 if no config)
// If invoice is linked to an appointment with a 'service', use that service for pricing
function addPartThenAlwaysLabor(invoice, partName, partPrice) {
  const items = invoice.items = (invoice.items || []);

  // 1) add the PART and capture its index
  const part = { name: partName, qty: 1, price: Number(partPrice||0) };
  const partIndex = Labor.push(part) - 1;

  // 2) figure out service name (from linked appointment, if any)
  let serviceName = null;
  if (invoice.appointment_id) {
    const d = _getData();
    const appt = (d.appointments || []).find(a => a.id === invoice.appointment_id);
    if (appt && appt.service) serviceName = appt.service;
  }

  // 3) build the LABOR line (even if $0.00)
  const labor = makeLaborItemForServiceAlways(serviceName, partName);

  // 4) INSERT labor immediately after the part (index + 1) to lock in order
  items.splice(partIndex + 1, 0, labor);


  return invoice;
}


// When removing a part row, also remove its paired auto-labor row (matched by _forPart)
function removePartAndAutoLabor(invoice, partIndex) {
  if (!invoice.items || partIndex < 0 || partIndex >= invoice.items.length) return;
  const part = invoice.items[partIndex];
  const partName = part && part.name;
  invoice.items.splice(partIndex, 1); // remove part
  if (!partName) return;

  const i = (invoice.items || []).findIndex(it => it && it._autoLabor && it._forPart === partName);
  if (i >= 0) invoice.items.splice(i, 1); // remove paired labor
}

document.addEventListener('DOMContentLoaded', __mainBase);



    
    // Close menu when clicking a navigation link
    const navLinks = mainNav.querySelectorAll("a");
    navLinks.forEach(link => {
      link.addEventListener("click", () => {
        menuToggle.classList.remove("active");
        mainNav.classList.remove("active");
      });
    });
    
    // Close menu when clicking outside
    document.addEventListener("click", function(event) {
      if (mainNav.classList.contains("active") && 
          !mainNav.contains(event.target) && 
          !menuToggle.contains(event.target)) {
        menuToggle.classList.remove("active");
        mainNav.classList.remove("active");
      }
    });
  }
});


