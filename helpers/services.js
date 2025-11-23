// Service config helpers extracted from app.js
import { LS } from './constants.js';
import { readLS } from './storage.js';
import { getCurrentShop } from './user.js';

export function getServiceConfigById(sid) {
  if (!sid) return null;
  const d = _getDataSafe();
  const list = (d.settings && d.settings.services) || [];
  const cur = _curShopId();
  return list.find(s => String(s.id) === String(sid) && (!s.shop_id || s.shop_id === cur)) || null;
}

export function getServiceConfigByName(name) {
  if (!name) return null;
  const d = _getDataSafe();
  const list = (d.settings && d.settings.services) || [];
  const cur = _curShopId();
  const lower = String(name).toLowerCase();
  return list.find(s => String(s.name || "").toLowerCase() === lower && (!s.shop_id || s.shop_id === cur)) || null;
}

function _getDataSafe() {
  try { return readLS(LS.data, {}) || {}; } catch (e) { return {}; }
}
function _curShopId() {
  try { const s = getCurrentShop(); return s && s.id; } catch (e) { return null; }
}
