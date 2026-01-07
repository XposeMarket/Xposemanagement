/**
 * shop-config-loader.js
 * Loads and caches shop industry configuration for the current session
 */

import { getIndustryConfig, getTerm, hasFeature, usesVehicles, getPrimaryEntity } from './industry-config.js';

// Cache for current shop's config
let _currentShopConfig = null;
let _currentIndustryType = null;

/**
 * Initialize shop configuration by loading from shop data
 * @param {Object} shopData - Shop data from database
 */
export function initializeShopConfig(shopData) {
  if (!shopData) {
    console.warn('No shop data provided for config initialization');
    return;
  }
  
  _currentIndustryType = shopData.industry_type || 'auto_shop';
  _currentShopConfig = getIndustryConfig(_currentIndustryType);
  
  console.log(`✅ Shop config initialized for ${_currentShopConfig.name} (${_currentIndustryType})`);
  
  // Store in sessionStorage for quick access
  sessionStorage.setItem('xm_industry_type', _currentIndustryType);
  sessionStorage.setItem('xm_shop_config', JSON.stringify(_currentShopConfig));
}

/**
 * Get current shop's industry type
 */
export function getCurrentIndustryType() {
  if (!_currentIndustryType) {
    _currentIndustryType = sessionStorage.getItem('xm_industry_type') || 'auto_shop';
  }
  return _currentIndustryType;
}

/**
 * Get current shop's configuration
 */
export function getCurrentConfig() {
  if (!_currentShopConfig) {
    const cached = sessionStorage.getItem('xm_shop_config');
    if (cached) {
      _currentShopConfig = JSON.parse(cached);
    } else {
      _currentShopConfig = getIndustryConfig(getCurrentIndustryType());
    }
  }
  return _currentShopConfig;
}

/**
 * Get terminology for the current shop
 */
export function getCurrentTerm(term, plural = false) {
  return getTerm(getCurrentIndustryType(), term, plural);
}

/**
 * Check if current shop has a specific feature
 */
export function hasCurrentFeature(feature) {
  return hasFeature(getCurrentIndustryType(), feature);
}

/**
 * Check if current shop uses vehicles
 */
export function currentUsesVehicles() {
  return usesVehicles(getCurrentIndustryType());
}

/**
 * Get primary entity type for current shop
 */
export function getCurrentPrimaryEntity() {
  return getPrimaryEntity(getCurrentIndustryType());
}

/**
 * Clear cached configuration (call on logout or shop switch)
 */
export function clearShopConfig() {
  _currentShopConfig = null;
  _currentIndustryType = null;
  sessionStorage.removeItem('xm_industry_type');
  sessionStorage.removeItem('xm_shop_config');
}

/**
 * Update page terminology based on industry
 * Replaces common terms in the DOM with industry-specific terminology
 */
export function updatePageTerminology() {
  const config = getCurrentConfig();
  
  // Update page title if it contains generic terms
  const titleElement = document.querySelector('h1, .page-title');
  if (titleElement) {
    let title = titleElement.textContent;
    title = title.replace(/\bJobs?\b/gi, config.terminology.jobs);
    title = title.replace(/\bCustomers?\b/gi, config.terminology.clients);
    title = title.replace(/\bVehicles?\b/gi, currentUsesVehicles() ? 'Vehicles' : config.terminology.clients);
    titleElement.textContent = title;
  }
  
  // Update navigation labels
  document.querySelectorAll('nav a, .nav-item').forEach(el => {
    let text = el.textContent;
    text = text.replace(/\bJobs?\b/gi, config.terminology.jobs);
    text = text.replace(/\bCustomers?\b/gi, config.terminology.clients);
    text = text.replace(/\bVehicles?\b/gi, currentUsesVehicles() ? 'Vehicles' : config.terminology.clients);
    text = text.replace(/\bStaff\b/gi, config.terminology.staffPlural);
    el.textContent = text;
  });
  
  // Update button labels
  document.querySelectorAll('button, .btn').forEach(el => {
    let text = el.textContent;
    if (text.includes('Add Job')) {
      el.textContent = text.replace('Add Job', `Add ${config.terminology.job}`);
    }
    if (text.includes('New Job')) {
      el.textContent = text.replace('New Job', `New ${config.terminology.job}`);
    }
    if (text.includes('Add Customer')) {
      el.textContent = text.replace('Add Customer', `Add ${config.terminology.client}`);
    }
  });
  
  console.log('✅ Page terminology updated for', config.name);
}

/**
 * Get UI classes for industry-specific styling
 */
export function getIndustryClasses() {
  const industryType = getCurrentIndustryType();
  return {
    primary: `industry-${industryType}`,
    icon: getCurrentConfig().icon
  };
}
