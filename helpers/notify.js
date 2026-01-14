// helpers/notify.js
// Small global notification banner helper
// helpers/notify.js
// Small global notification banner helper (ES module)

function ensureContainer(){
  let c = document.getElementById('xm_notify_container');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'xm_notify_container';
  c.style.position = 'fixed';
  c.style.top = '18px';
  c.style.left = '50%';
  c.style.transform = 'translateX(-50%)';
  c.style.zIndex = '99999';
  c.style.pointerEvents = 'none';
  document.body.appendChild(c);
  return c;
}

function showBanner(message, type='success', duration=3000){
  try {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = 'xm-notify';
    el.style.pointerEvents = 'auto';
    el.style.margin = '6px 0';
    el.style.minWidth = '240px';
    el.style.maxWidth = '720px';
    el.style.padding = '12px 18px';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 8px 30px rgba(2,6,23,0.15)';
    el.style.color = type === 'error' ? 'white' : '#064e3b';
    el.style.fontWeight = '600';
    el.style.fontSize = '14px';
    el.style.background = type === 'success' ? '#bbf7d0' : (type === 'error' ? '#ef4444' : '#e2e8f0');
    el.textContent = message;
    container.appendChild(el);
    // animate in
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    requestAnimationFrame(() => { el.style.transition = 'all 220ms ease'; el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    // auto remove
    setTimeout(() => {
      try { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; } catch(e){}
      setTimeout(() => { try { el.remove(); } catch(e){} }, 240);
    }, duration);
    return el;
  } catch (e) { try { alert(message); } catch (er){} }
}

// Expose utilities on window for backwards compatibility
if (typeof window !== 'undefined') {
  window.showConfirmationBanner = function(message, duration){ return showBanner(message, 'success', duration || 3000); };
  window.showNotificationBanner = function(message, type='info', duration){ return showBanner(message, type, duration || 3000); };
}

// Named export for ES modules
export { showBanner };

