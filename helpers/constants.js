// ============================================================================
// CONSTANTS.JS - Single Source of Truth
// ============================================================================
// NEVER duplicate these in other files!
// Always import from here: import { LS } from '../helpers/constants.js';
// ============================================================================

// helpers/constants.js - Single source of truth
export const LS = {
  users: 'xm_users',
  shops: 'xm_shops',
  session: 'xm_session',
  data: 'xm_data',      // ← CHANGE TO xm_data (not crm_data)
  seeded: 'xm_seeded'
};

export const ROLE_PAGES = {
  admin: ["dashboard", "invoice", "appointments", "jobs", "messages", "invoices", "customers", "settings", "profile", "admin", "revenue"],
  // 'owner' role may be used on some installations to represent the shop owner.
  // Map it to the same pages as admin so owners can access admin-only pages like revenue.
  owner: ["dashboard", "invoice", "appointments", "jobs", "messages", "invoices", "customers", "settings", "profile", "admin", "revenue"],
  service_writer: ["dashboard", "invoice", "customers", "appointments", "messages", "invoices", "profile"],
  receptionist: ["dashboard", "messages", "customers", "appointments", "profile"],
  staff: ["dashboard", "appointments", "jobs", "profile"]
};

export const STATUS_COLORS = {
  new: '#6b7280',
  scheduled: '#3b82f6',
  in_progress: '#f59e0b',
  awaiting_parts: '#eab308',
  completed: '#10b981'
};

export const STATUS_MAP = {
  new: "open",
  scheduled: "scheduled",
  in_progress: "progress",
  awaiting_parts: "parts",
  completed: "done"
};
