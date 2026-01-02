/**
 * supplierLinks.js
 * Handles the supplier quick links functionality in the parts modal
 */

// Supplier configuration with names, logos, and URLs
const SUPPLIERS = [
  {
    name: 'PartsTech',
    logo: 'assets/Parts Suppliers/partstech-logo.png',
    url: 'https://app.partstech.com/',
    fallbackLogo: '🔧' // Emoji fallback if logo doesn't exist
  },
  {
    name: 'Carquest/Advance Auto',
    logo: 'assets/Parts Suppliers/CarwquestLogo.webp',
    url: 'https://app.partstech.com/'
  },
  {
    name: 'WorldPac',
    logo: 'assets/Parts Suppliers/Worldpaclogo.png',
    url: 'https://speeddial.worldpac.com/#/login'
  },
  {
    name: 'AutoZone',
    logo: 'assets/Parts Suppliers/AutoZone-Logo-640x400.png',
    url: 'https://www.autozone.com'
  },
  {
    name: 'NAPA',
    logo: 'assets/Parts Suppliers/NAPA_Auto_Parts_logo.svg.png',
    url: 'https://www.napaonline.com'
  },
  {
    name: "O'Reilly",
    logo: 'assets/Parts Suppliers/oreillyslogo.png',
    url: 'https://www.oreillyauto.com'
  },
  {
    name: 'Summit Racing',
    logo: 'assets/Parts Suppliers/Summit-Racing-Equipment-Logo-1024x580.webp',
    url: 'https://www.summitracing.com'
  },
  {
    name: 'Parts Authority',
    logo: 'assets/Parts Suppliers/partsauthoritylogo.jpg',
    url: 'https://www.partsauthority.com'
  },
  {
    name: 'RockAuto',
    logo: 'assets/Parts Suppliers/rock-auto.jpg',
    url: 'https://www.rockauto.com'
  }
];

/**
 * Initialize supplier links in the parts modal
 */
function initSupplierLinks() {
  const partsModal = document.getElementById('partsModal');
  if (!partsModal) {
    console.warn('Parts modal not found, cannot initialize supplier links');
    return;
  }

  // Find the vehicle info section and insert supplier links after it
  const vehicleInfo = document.getElementById('partsVehicleInfo');
  if (!vehicleInfo) {
    console.warn('Vehicle info section not found');
    return;
  }

  // Create supplier links container
  const supplierSection = document.createElement('div');
  supplierSection.id = 'supplierQuickLinks';
  supplierSection.style.cssText = 'margin-bottom: 20px;';
  
  const heading = document.createElement('h4');
  heading.style.cssText = 'margin: 0 0 12px 0; font-size: 1rem; font-weight: 600;';
  heading.textContent = 'Quick Order from Suppliers';
  
  const linksContainer = document.createElement('div');
  linksContainer.className = 'supplier-links-container';
  
  supplierSection.appendChild(heading);
  supplierSection.appendChild(linksContainer);
  
  // Insert after vehicle info
  vehicleInfo.parentNode.insertBefore(supplierSection, vehicleInfo.nextSibling);
  
  // Populate supplier links
  renderSupplierLinks(linksContainer);
  
  console.log('✅ Supplier links initialized');
}

/**
 * Render supplier links into the container
 */
function renderSupplierLinks(container) {
  container.innerHTML = '';
  
  SUPPLIERS.forEach(supplier => {
    const linkCard = document.createElement('div');
    linkCard.className = 'supplier-link-card';
    linkCard.setAttribute('data-supplier', supplier.name);
    linkCard.setAttribute('title', `Open ${supplier.name} in new tab`);
    
    // Create logo element
    const logoWrapper = document.createElement('div');
    logoWrapper.className = 'supplier-logo-wrapper';
    
    const logo = document.createElement('img');
    logo.src = supplier.logo;
    logo.alt = supplier.name;
    logo.className = 'supplier-logo';
    
    // Handle logo load error
    logo.onerror = () => {
      if (supplier.fallbackLogo) {
        logoWrapper.innerHTML = `<span class="supplier-fallback-icon">${supplier.fallbackLogo}</span>`;
      } else {
        logo.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="16" fill="%23999"%3E${supplier.name.charAt(0)}%3C/text%3E%3C/svg%3E';
      }
    };
    
    logoWrapper.appendChild(logo);
    
    // Create supplier name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'supplier-name';
    nameLabel.textContent = supplier.name;
    
    linkCard.appendChild(logoWrapper);
    linkCard.appendChild(nameLabel);
    
    // Add click handler
    linkCard.addEventListener('click', () => handleSupplierClick(supplier));
    
    container.appendChild(linkCard);
  });
}

/**
 * Handle supplier link click
 */
function handleSupplierClick(supplier) {
  console.log(`Opening ${supplier.name}...`);
  
  // Open supplier website in new tab
  window.open(supplier.url, '_blank', 'noopener,noreferrer');
  
  // Open the part pricing modal with supplier name
  setTimeout(() => {
    openPartPricingModalForSupplier(supplier.name);
  }, 100); // Small delay to ensure tab opens first
}

/**
 * Open Part Pricing Modal for supplier order
 */
function openPartPricingModalForSupplier(supplierName) {
  const partsModal = document.getElementById('partsModal');
  
  // Try to get job ID from parts modal if it's open
  let jobId = partsModal?.dataset?.jobId;
  
  // If no job ID, try to find it from the current page context
  if (!jobId) {
    console.log('No job ID in parts modal, checking page context...');
    
    // Try to get from currently visible job row (if parts modal was just opened)
    const jobRows = document.querySelectorAll('[data-job-id]');
    if (jobRows.length > 0) {
      // Get the first job ID as fallback
      jobId = jobRows[0].dataset.jobId;
      console.log('Using first available job ID:', jobId);
    }
  }
  
  if (!jobId) {
    console.warn('No job ID available - showing notification');
    // Show friendly notification
    if (typeof showNotification === 'function') {
      showNotification('Please click "Parts" on a job first, then click the supplier link', 'error');
    } else {
      alert('Please click "Parts" on a job first, then click the supplier link');
    }
    return;
  }
  
  // Create a blank part object for manual entry from supplier
  const blankPart = {
    id: `manual_${Date.now()}`, // Unique ID for this manual entry
    part_name: '',
    name: '',
    part_number: '', // Optional field
    description: '',
    cost_price: '',
    sell_price: '',
    core_price: 0,
    quantity_available: 1,
    supplier: supplierName || 'Manual Entry', // Use the actual supplier name clicked
    manufacturer: '',
    manual_entry: true, // Flag to indicate this is manual entry from supplier
    allow_edit_part_number: true // Allow user to optionally enter part number
  };
  
  // Check if partPricingModal component exists and use it
  if (window.partPricingModal && typeof window.partPricingModal.show === 'function') {
    console.log('✅ Opening Part Pricing Modal via window.partPricingModal.show()');
    window.partPricingModal.show(blankPart, jobId);
  } 
  // Fallback: try xm_partPricingModal
  else if (window.xm_partPricingModal && typeof window.xm_partPricingModal.show === 'function') {
    console.log('✅ Opening Part Pricing Modal via window.xm_partPricingModal.show()');
    window.xm_partPricingModal.show(blankPart, jobId);
  }
  // Fallback: try to use the global function if it exists
  else if (typeof window.showPartPricingModal === 'function') {
    console.log('✅ Opening Part Pricing Modal via window.showPartPricingModal()');
    window.showPartPricingModal(blankPart, jobId);
  }
  // Final fallback: dispatch custom event that part pricing modal can listen to
  else {
    console.log('⚠️ Part pricing modal not found, dispatching event');
    const event = new CustomEvent('openPartPricingModal', {
      detail: { part: blankPart, jobId: jobId }
    });
    window.dispatchEvent(event);
    console.log('✅ Dispatched openPartPricingModal event');
  }
  
  console.log('✅ Part Pricing Modal opened for supplier order (job ID: ' + jobId + ')');
}

// Initialize when the parts modal is opened
function onPartsModalOpened() {
  // Check if supplier links section exists, if not create it
  if (!document.getElementById('supplierQuickLinks')) {
    initSupplierLinks();
  }
}

// Export for use in jobs.js
if (typeof window !== 'undefined') {
  window.supplierLinks = {
    init: initSupplierLinks,
    onModalOpened: onPartsModalOpened
  };
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupplierLinks);
} else {
  // DOM already loaded
  initSupplierLinks();
}
