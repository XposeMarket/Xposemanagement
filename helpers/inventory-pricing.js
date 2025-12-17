// helpers/inventory-pricing.js
// Handles pricing calculations and retail price updates for inventory items

/**
 * Sets up pricing calculation for an inventory item
 * Calculates retail price based on cost and markup percentage
 * @param {HTMLElement} form - The form element containing pricing inputs
 */
export function setupInventoryPricing(form) {
    const costInput = form.querySelector('#itemCost');
    const markupInput = form.querySelector('#itemMarkup');
    const retailInput = form.querySelector('#itemRetail');

    if (!costInput || !markupInput || !retailInput) {
        console.warn('Pricing inputs not found in form');
        return;
    }

    function calculateRetailPrice() {
        const cost = parseFloat(costInput.value) || 0;
        const markup = parseFloat(markupInput.value) || 0;
        
        if (cost > 0 && markup >= 0) {
            const retailPrice = cost * (1 + markup / 100);
            retailInput.value = retailPrice.toFixed(2);
        }
    }

    // Add event listeners to recalculate when cost or markup changes
    costInput.addEventListener('input', calculateRetailPrice);
    markupInput.addEventListener('input', calculateRetailPrice);

    // Initial calculation if values exist
    calculateRetailPrice();
}

/**
 * Calculates retail price from cost and markup
 * @param {number} cost - Item cost
 * @param {number} markup - Markup percentage
 * @returns {number} Calculated retail price
 */
export function calculateRetail(cost, markup) {
    if (!cost || cost <= 0) return 0;
    if (!markup || markup < 0) return cost;
    
    return cost * (1 + markup / 100);
}

/**
 * Calculates markup percentage from cost and retail
 * @param {number} cost - Item cost
 * @param {number} retail - Retail price
 * @returns {number} Calculated markup percentage
 */
export function calculateMarkup(cost, retail) {
    if (!cost || cost <= 0) return 0;
    if (!retail || retail <= cost) return 0;
    
    return ((retail - cost) / cost) * 100;
}
