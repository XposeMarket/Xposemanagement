// ============================================================================
// INVOICE HELPERS - Functions for creating/managing invoices
// FIXED: Added vehicle field to invoice creation
// ============================================================================

import { LS } from './constants.js';
import { readLS, writeLS } from './storage.js';
import { todayISO } from './utils.js';
import { getServiceConfigById, getServiceConfigByName } from './services.js';

/**
 * Calculate total for an invoice
 */
export function calcInvTotal(inv) {
  const sub = (inv.items || []).reduce((a, i) => a + ((i.qty || 0) * (i.price || 0)), 0);
  const tax = sub * (inv.tax_rate || 0) / 100;
  const disc = inv.discount || 0;
  return sub + tax - disc;
}

/**
 * Calculate profit for an invoice.
 * - For items that include a `cost_price` (parts), profit = (sell - cost) * qty
 * - For other items (labor/services) profit = sell * qty (assumes no direct cost tracked)
 * - Discounts reduce profit; tax is treated as passthrough and not included in profit
 */
export function calcInvProfit(inv) {
  const items = inv.items || [];
  let profit = 0;
  for (const i of items) {
    const qty = Number(i.qty || 0);
    const sell = Number(i.price || 0);
    const cost = Number(i.cost_price || i.cost || 0);
    if (qty <= 0) continue;
    if (cost > 0) {
      profit += (sell - cost) * qty;
    } else {
      // No cost tracked — assume whole sell amount is revenue/profit (labor/services)
      profit += sell * qty;
    }
  }
  // Apply discount (assume discount is an absolute or percentage? existing code treats discount as percent in some places.
  // In our system `discount` has historically been a percentage value; handle both cases conservatively:
  const disc = inv.discount || 0;
  if (disc) {
    if (disc > 0 && disc <= 100) {
      // percentage discount
      profit = profit - (profit * (Number(disc) / 100));
    } else {
      // absolute discount value
      profit = profit - Number(disc);
    }
  }
  return Math.round(profit * 100) / 100;
}

/**
 * Ensure invoice exists for appointment (creates if missing)
 * Reuses existing invoice if present (open or paid)
 * FIXED: Now includes vehicle information from appointment
 */
export function ensureInvoiceForAppt(apptId) {
  try {
    const d = readLS(LS.data, { appointments: [], invoices: [] });
    if (!d) return null;

    // Reuse existing (open or paid)
    let inv = (d.invoices || []).find(i => i.appointment_id === apptId);
    if (inv) return inv;

    const appt = (d.appointments || []).find(a => a.id === apptId) || null;
    const next = (d.invoices || []).reduce((mx, i) => Math.max(mx, Number(i.number || 0) || 0), 1000) + 1;
    
    // Create invoice with vehicle information
    inv = {
      id: "inv" + Date.now(),
      number: String(next),
      customer: appt ? (`${appt.customer_first || ""} ${appt.customer_last || ""}`.trim() || "Walk-in") : "Walk-in",
      customer_first: appt ? appt.customer_first : "",
      customer_last: appt ? appt.customer_last : "",
      vehicle: appt ? (appt.vehicle || "") : "", // FIXED: Added vehicle
      vin: appt ? (appt.vin || "") : "",           // FIXED: Added VIN
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
  } catch (_e) {
    return null;
  }
}

/**
 * Get or create an open invoice for an appointment
 * If paid invoice exists, creates a new one
 * FIXED: Now includes vehicle information
 */
export function getOrCreateOpenInvoice(apptId) {
  const d = readLS(LS.data, { appointments: [], invoices: [] });

  // Try to find existing open invoice
  let inv = (d.invoices || []).find(i => i.appointment_id === apptId && (i.status || "open") !== "paid");
  if (inv) return inv;

  // Fallback: any invoice by appt
  inv = (d.invoices || []).find(i => i.appointment_id === apptId);
  if (inv && (inv.status || "open") === "paid") {
    // Create a new one
    const next = (d.invoices || []).reduce((mx, i) => Math.max(mx, Number(i.number || 0) || 0), 1000) + 1;
    const appt = (d.appointments || []).find(a => a.id === apptId) || null;
    
    inv = {
      id: "inv" + Date.now(),
      number: String(next),
      customer: appt ? (`${appt.customer_first || ""} ${appt.customer_last || ""}`.trim() || "Walk-in") : "Walk-in",
      customer_first: appt ? appt.customer_first : "",
      customer_last: appt ? appt.customer_last : "",
      vehicle: appt ? (appt.vehicle || "") : "", // FIXED: Added vehicle
      vin: appt ? (appt.vin || "") : "",           // FIXED: Added VIN
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

  // Else create new
  return ensureInvoiceForAppt(apptId);
}

/**
 * Add BOTH a Part line AND a Labor line to invoice
 * @param {string} apptId - Appointment ID
 * @param {object} part - Part object with name, brand, price
 * @param {object} labor - Labor object with hours, rate
 */
export function addPartAndLaborToInvoice(apptId, part, labor) {
  try {
    const d = readLS(LS.data, { appointments: [], invoices: [] });
    const inv = getOrCreateOpenInvoice(apptId);
    if (!inv) return false;

    const idx = (d.invoices || []).findIndex(i => i.id === inv.id);
    if (idx < 0) return false;

    const items = d.invoices[idx].items = d.invoices[idx].items || [];

    // 1) Part line
    const partLine = {
      name: `${(part.name || "").toString()}${part.brand ? (" · " + part.brand) : ""}`,
      qty: 1,
      price: Number(part.price || 0)
    };
    items.push(partLine);

    // 2) Labor line (qty = hours, price = rate)
    const hours = Number(labor && labor.hours || 0);
    const rate = Number(labor && labor.rate || 0);
    const laborLine = {
      name: `Labor - ${(part.name || "").toString()}`,
      qty: hours,
      price: rate
    };
    items.push(laborLine);

    writeLS(LS.data, d);
    return true;
  } catch (e) {
    console.warn("addPartAndLaborToInvoice error", e);
    return false;
  }
}

/**
 * Helper to generate unique prefill key
 */
function _apptPrefillKey(apptId) {
  return `appt_prefilled_${apptId}`;
}

/**
 * Prefill invoice from appointment service configuration
 * Only runs once per appointment (uses sessionStorage guard)
 */
export function prefillInvoiceFromAppointment(appt) {
  if (!appt || !appt.id) return;
  const guardKey = _apptPrefillKey(appt.id);
  if (sessionStorage.getItem(guardKey)) return; // Only once per appt

  const sid = appt.service_id || appt.service || appt.svc_id;
  const sname = appt.service_name || appt.serviceLabel || appt.service;

  const svc = getServiceConfigById(sid) || getServiceConfigByName(sname);
  const label = `Labor - ${svc?.name || sname || "Service"}`;
  const rate = Number(svc?.rate || 0);
  const hours = Number(svc?.hours || 0);
  // Prefer base-price services; fallback to labor math
  const base = Number(svc?.price ?? svc?.base_price ?? 0);
  const price = Number.isFinite(base) && base > 0 ? base : (rate * hours);

  // Prevent duplicate by label if user already added it
  try {
    const existing = document.querySelectorAll(".itm-name");
    for (const el of existing) {
      if (String(el.value || "").trim().toLowerCase() === label.toLowerCase()) return;
    }
  } catch (e) { }

  // Use your exact addItem implementation
  if (typeof addItem === "function") addItem(label, 1, price);

  try { if (typeof calc === "function") calc(); } catch (e) { }
  try { if (typeof saveDraft === "function") saveDraft(); } catch (e) { }

  sessionStorage.setItem(guardKey, "1");
}
