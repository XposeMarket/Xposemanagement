// Helper to calculate platform fee and net total for an invoice
// Platform fee: Stripe (2.7% + $0.05) + Xpose (2.3%)
window.calcPlatformFee = function(subtotal) {
  const stripePercent = 0.027;
  const xposePercent = 0.023;
  const fixedPerTxn = 0.05;
  const platformPercent = stripePercent + xposePercent; // 0.05
  return (subtotal * platformPercent) + fixedPerTxn;
};

window.calcNetTotal = function(inv) {
  const items = inv.items || [];
  const subtotal = items.reduce((sum, itm) => sum + ((Number(itm.qty) || 0) * (Number(itm.price) || 0)), 0);
  const tax = subtotal * ((inv.tax_rate || 0) / 100);
  const discount = subtotal * ((inv.discount || 0) / 100);
  const total = subtotal + tax - discount;
  const platformFee = window.calcPlatformFee(subtotal);
  return total - platformFee;
};

// Export for use in revenue.js
if (typeof module !== 'undefined') module.exports = { calcPlatformFee, calcNetTotal };