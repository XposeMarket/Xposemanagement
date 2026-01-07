/**
 * industry-config.js
 * Configuration system for multi-industry support
 * Maps industry types to UI terminology, features, and workflows
 */

// Industry type definitions
export const INDUSTRY_TYPES = {
  AUTO_SHOP: 'auto_shop',
  BARBERSHOP: 'barbershop',
  TATTOO_STUDIO: 'tattoo_studio',
  NAIL_SALON: 'nail_salon',
  OTHER: 'other'
};

// Industry-specific configuration
export const INDUSTRY_CONFIG = {
  auto_shop: {
    name: 'Auto Shop',
    icon: '🔧',
    primaryEntity: 'vehicle',
    terminology: {
      job: 'Job',
      jobs: 'Jobs',
      client: 'Customer',
      clients: 'Customers',
      service: 'Labor',
      services: 'Labor Items',
      product: 'Part',
      products: 'Parts',
      appointment: 'Service Appointment',
      appointments: 'Service Appointments',
      staff: 'Technician',
      staffPlural: 'Technicians'
    },
    features: {
      vehicles: true,
      inventory: true,
      vin_lookup: true,
      mileage_tracking: true,
      parts_ordering: true,
      labor_rates: true,
      estimates: true,
      scheduling: true,
      messaging: true,
      invoicing: true
    },
    fields: {
      vehicle: ['vin', 'make', 'model', 'year', 'mileage', 'license_plate', 'color'],
      job: ['vehicle_id', 'mileage_in', 'mileage_out', 'diagnosis', 'parts', 'labor']
    }
  },
  
  barbershop: {
    name: 'Barbershop / Salon',
    icon: '✂️',
    primaryEntity: 'client',
    terminology: {
      job: 'Appointment',
      jobs: 'Appointments',
      client: 'Client',
      clients: 'Clients',
      service: 'Service',
      services: 'Services',
      product: 'Product',
      products: 'Retail Products',
      appointment: 'Appointment',
      appointments: 'Appointments',
      staff: 'Stylist',
      staffPlural: 'Stylists'
    },
    features: {
      vehicles: false,
      inventory: true, // For retail products
      vin_lookup: false,
      mileage_tracking: false,
      parts_ordering: false,
      labor_rates: false,
      estimates: false,
      scheduling: true,
      messaging: true,
      invoicing: true,
      service_duration: true,
      recurring_appointments: true
    },
    fields: {
      client: ['name', 'phone', 'email', 'notes', 'preferences'],
      appointment: ['client_id', 'staff_id', 'service_type', 'duration', 'notes']
    },
    services: [
      { name: 'Haircut - Men', duration: 30, price: 25 },
      { name: 'Haircut - Women', duration: 45, price: 40 },
      { name: 'Beard Trim', duration: 15, price: 15 },
      { name: 'Color', duration: 90, price: 80 },
      { name: 'Highlights', duration: 120, price: 120 },
      { name: 'Blowout', duration: 30, price: 35 }
    ]
  },
  
  tattoo_studio: {
    name: 'Tattoo & Piercing Studio',
    icon: '🖊️',
    primaryEntity: 'client',
    terminology: {
      job: 'Session',
      jobs: 'Sessions',
      client: 'Client',
      clients: 'Clients',
      service: 'Service',
      services: 'Services',
      product: 'Aftercare Product',
      products: 'Aftercare Products',
      appointment: 'Booking',
      appointments: 'Bookings',
      staff: 'Artist',
      staffPlural: 'Artists'
    },
    features: {
      vehicles: false,
      inventory: true, // For aftercare products
      vin_lookup: false,
      mileage_tracking: false,
      parts_ordering: false,
      labor_rates: false,
      estimates: true, // For custom designs
      scheduling: true,
      messaging: true,
      invoicing: true,
      deposits: true,
      design_gallery: true,
      session_tracking: true
    },
    fields: {
      client: ['name', 'phone', 'email', 'age_verified', 'consent_form', 'allergies', 'medical_notes'],
      session: ['client_id', 'artist_id', 'design_type', 'placement', 'size', 'hours', 'deposit_paid', 'total_sessions']
    },
    services: [
      { name: 'Small Tattoo', duration: 60, price: 100 },
      { name: 'Medium Tattoo', duration: 120, price: 200 },
      { name: 'Large Tattoo', duration: 240, price: 400 },
      { name: 'Touch-up', duration: 30, price: 50 },
      { name: 'Piercing', duration: 20, price: 40 },
      { name: 'Consultation', duration: 30, price: 0 }
    ]
  },
  
  nail_salon: {
    name: 'Nail Salon / Spa',
    icon: '💅',
    primaryEntity: 'client',
    terminology: {
      job: 'Appointment',
      jobs: 'Appointments',
      client: 'Client',
      clients: 'Clients',
      service: 'Service',
      services: 'Services',
      product: 'Product',
      products: 'Retail Products',
      appointment: 'Appointment',
      appointments: 'Appointments',
      staff: 'Technician',
      staffPlural: 'Technicians'
    },
    features: {
      vehicles: false,
      inventory: true,
      vin_lookup: false,
      mileage_tracking: false,
      parts_ordering: false,
      labor_rates: false,
      estimates: false,
      scheduling: true,
      messaging: true,
      invoicing: true,
      service_duration: true,
      service_packages: true,
      recurring_appointments: true
    },
    fields: {
      client: ['name', 'phone', 'email', 'notes', 'preferences', 'allergies'],
      appointment: ['client_id', 'staff_id', 'service_type', 'duration', 'notes', 'package_id']
    },
    services: [
      { name: 'Manicure', duration: 30, price: 25 },
      { name: 'Pedicure', duration: 45, price: 40 },
      { name: 'Gel Nails', duration: 60, price: 45 },
      { name: 'Acrylic Full Set', duration: 90, price: 60 },
      { name: 'Acrylic Fill', duration: 60, price: 40 },
      { name: 'Nail Art', duration: 30, price: 15 }
    ]
  },
  
  other: {
    name: 'Other Service Business',
    icon: '💼',
    primaryEntity: 'client',
    terminology: {
      job: 'Appointment',
      jobs: 'Appointments',
      client: 'Client',
      clients: 'Clients',
      service: 'Service',
      services: 'Services',
      product: 'Product',
      products: 'Products',
      appointment: 'Appointment',
      appointments: 'Appointments',
      staff: 'Staff Member',
      staffPlural: 'Staff'
    },
    features: {
      vehicles: false,
      inventory: true,
      vin_lookup: false,
      mileage_tracking: false,
      parts_ordering: false,
      labor_rates: false,
      estimates: true,
      scheduling: true,
      messaging: true,
      invoicing: true
    },
    fields: {
      client: ['name', 'phone', 'email', 'notes'],
      appointment: ['client_id', 'staff_id', 'service_type', 'duration', 'notes']
    }
  }
};

/**
 * Get industry configuration for a given industry type
 */
export function getIndustryConfig(industryType) {
  return INDUSTRY_CONFIG[industryType] || INDUSTRY_CONFIG.other;
}

/**
 * Get terminology for a specific term in a given industry
 */
export function getTerm(industryType, term, plural = false) {
  const config = getIndustryConfig(industryType);
  if (plural && config.terminology[term + 's']) {
    return config.terminology[term + 's'];
  }
  return config.terminology[term] || term;
}

/**
 * Check if a feature is enabled for a given industry
 */
export function hasFeature(industryType, feature) {
  const config = getIndustryConfig(industryType);
  return config.features[feature] === true;
}

/**
 * Get required fields for a given entity type in an industry
 */
export function getFields(industryType, entityType) {
  const config = getIndustryConfig(industryType);
  return config.fields[entityType] || [];
}

/**
 * Get default services for an industry (if any)
 */
export function getDefaultServices(industryType) {
  const config = getIndustryConfig(industryType);
  return config.services || [];
}

/**
 * Determine if industry uses vehicles as primary entity
 */
export function usesVehicles(industryType) {
  return hasFeature(industryType, 'vehicles');
}

/**
 * Get the primary entity type for an industry
 */
export function getPrimaryEntity(industryType) {
  const config = getIndustryConfig(industryType);
  return config.primaryEntity || 'client';
}
