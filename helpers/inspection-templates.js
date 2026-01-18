/**
 * helpers/inspection-templates.js
 * Digital Vehicle Inspection Templates
 * 
 * Contains predefined inspection templates with sections and items.
 * Each template defines what gets checked during an inspection.
 */

// =============================================
// INSPECTION TEMPLATES
// =============================================

export const INSPECTION_TEMPLATES = {
  standard_dvi: {
    id: 'standard_dvi',
    name: 'Standard DVI',
    description: 'Full 45-point digital vehicle inspection',
    icon: '📋',
    estimatedTime: '30-45 min',
    sections: [
      {
        name: 'Tires & Wheels',
        icon: '🛞',
        items: [
          { name: 'Front Left Tire Tread', defaultStatus: 'pass' },
          { name: 'Front Left Tire Condition', defaultStatus: 'pass' },
          { name: 'Front Right Tire Tread', defaultStatus: 'pass' },
          { name: 'Front Right Tire Condition', defaultStatus: 'pass' },
          { name: 'Rear Left Tire Tread', defaultStatus: 'pass' },
          { name: 'Rear Left Tire Condition', defaultStatus: 'pass' },
          { name: 'Rear Right Tire Tread', defaultStatus: 'pass' },
          { name: 'Rear Right Tire Condition', defaultStatus: 'pass' },
          { name: 'Spare Tire', defaultStatus: 'pass' },
          { name: 'Wheel Alignment (Visual)', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Brakes',
        icon: '🛑',
        items: [
          { name: 'Front Brake Pads', defaultStatus: 'pass' },
          { name: 'Rear Brake Pads', defaultStatus: 'pass' },
          { name: 'Front Rotors', defaultStatus: 'pass' },
          { name: 'Rear Rotors', defaultStatus: 'pass' },
          { name: 'Brake Fluid Level', defaultStatus: 'pass' },
          { name: 'Brake Fluid Condition', defaultStatus: 'pass' },
          { name: 'Parking Brake', defaultStatus: 'pass' },
          { name: 'Brake Lines & Hoses', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Fluids',
        icon: '💧',
        items: [
          { name: 'Engine Oil Level', defaultStatus: 'pass' },
          { name: 'Engine Oil Condition', defaultStatus: 'pass' },
          { name: 'Transmission Fluid', defaultStatus: 'pass' },
          { name: 'Coolant Level', defaultStatus: 'pass' },
          { name: 'Coolant Condition', defaultStatus: 'pass' },
          { name: 'Power Steering Fluid', defaultStatus: 'pass' },
          { name: 'Windshield Washer Fluid', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Battery & Charging',
        icon: '🔋',
        items: [
          { name: 'Battery Condition', defaultStatus: 'pass' },
          { name: 'Battery Terminals', defaultStatus: 'pass' },
          { name: 'Battery Hold Down', defaultStatus: 'pass' },
          { name: 'Alternator Output', defaultStatus: 'pass' },
          { name: 'Starter Operation', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Belts & Hoses',
        icon: '🔧',
        items: [
          { name: 'Serpentine Belt', defaultStatus: 'pass' },
          { name: 'Timing Belt (if visible)', defaultStatus: 'n/a' },
          { name: 'Radiator Hoses', defaultStatus: 'pass' },
          { name: 'Heater Hoses', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Suspension & Steering',
        icon: '🚗',
        items: [
          { name: 'Shocks/Struts', defaultStatus: 'pass' },
          { name: 'Ball Joints', defaultStatus: 'pass' },
          { name: 'Tie Rod Ends', defaultStatus: 'pass' },
          { name: 'Control Arms', defaultStatus: 'pass' },
          { name: 'CV Boots/Axles', defaultStatus: 'pass' },
          { name: 'Steering Linkage', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Lights & Signals',
        icon: '💡',
        items: [
          { name: 'Headlights (Low Beam)', defaultStatus: 'pass' },
          { name: 'Headlights (High Beam)', defaultStatus: 'pass' },
          { name: 'Tail Lights', defaultStatus: 'pass' },
          { name: 'Brake Lights', defaultStatus: 'pass' },
          { name: 'Turn Signals (Front)', defaultStatus: 'pass' },
          { name: 'Turn Signals (Rear)', defaultStatus: 'pass' },
          { name: 'Hazard Lights', defaultStatus: 'pass' },
          { name: 'License Plate Light', defaultStatus: 'pass' },
          { name: 'Interior Lights', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Underbody',
        icon: '🔩',
        items: [
          { name: 'Exhaust System', defaultStatus: 'pass' },
          { name: 'Fuel Lines', defaultStatus: 'pass' },
          { name: 'Frame/Subframe', defaultStatus: 'pass' },
          { name: 'Oil Leaks', defaultStatus: 'pass' },
          { name: 'Coolant Leaks', defaultStatus: 'pass' },
          { name: 'Transmission Leaks', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Wipers & Glass',
        icon: '🪟',
        items: [
          { name: 'Windshield Condition', defaultStatus: 'pass' },
          { name: 'Wiper Blades (Front)', defaultStatus: 'pass' },
          { name: 'Wiper Blades (Rear)', defaultStatus: 'pass' },
          { name: 'Mirrors', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Air Filter & Cabin',
        icon: '🌬️',
        items: [
          { name: 'Engine Air Filter', defaultStatus: 'pass' },
          { name: 'Cabin Air Filter', defaultStatus: 'pass' }
        ]
      }
    ]
  },

  quick_check: {
    id: 'quick_check',
    name: 'Quick Check',
    description: 'Fast 10-point safety inspection',
    icon: '⚡',
    estimatedTime: '10-15 min',
    sections: [
      {
        name: 'Tires',
        icon: '🛞',
        items: [
          { name: 'Tire Tread Depth', defaultStatus: 'pass' },
          { name: 'Tire Condition/Damage', defaultStatus: 'pass' },
          { name: 'Tire Pressure', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Brakes',
        icon: '🛑',
        items: [
          { name: 'Brake Pads (Visual)', defaultStatus: 'pass' },
          { name: 'Brake Fluid Level', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Fluids',
        icon: '💧',
        items: [
          { name: 'Oil Level', defaultStatus: 'pass' },
          { name: 'Coolant Level', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Lights',
        icon: '💡',
        items: [
          { name: 'All Exterior Lights', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Battery',
        icon: '🔋',
        items: [
          { name: 'Battery Condition', defaultStatus: 'pass' }
        ]
      }
    ]
  },

  pre_purchase: {
    id: 'pre_purchase',
    name: 'Pre-Purchase',
    description: 'Comprehensive buyer inspection',
    icon: '🔍',
    estimatedTime: '60-90 min',
    sections: [
      {
        name: 'Exterior',
        icon: '🚙',
        items: [
          { name: 'Body Panel Alignment', defaultStatus: 'pass' },
          { name: 'Paint Condition', defaultStatus: 'pass' },
          { name: 'Rust/Corrosion', defaultStatus: 'pass' },
          { name: 'Glass Condition', defaultStatus: 'pass' },
          { name: 'Trim & Moldings', defaultStatus: 'pass' },
          { name: 'Accident/Repair Signs', defaultStatus: 'pass' },
          { name: 'Door Operation', defaultStatus: 'pass' },
          { name: 'Hood/Trunk Operation', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Interior',
        icon: '🪑',
        items: [
          { name: 'Seats Condition', defaultStatus: 'pass' },
          { name: 'Dashboard/Gauges', defaultStatus: 'pass' },
          { name: 'HVAC Operation', defaultStatus: 'pass' },
          { name: 'Power Windows', defaultStatus: 'pass' },
          { name: 'Power Locks', defaultStatus: 'pass' },
          { name: 'Audio System', defaultStatus: 'pass' },
          { name: 'Carpet/Headliner', defaultStatus: 'pass' },
          { name: 'Odors/Stains', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Tires & Wheels',
        icon: '🛞',
        items: [
          { name: 'Front Left Tire', defaultStatus: 'pass' },
          { name: 'Front Right Tire', defaultStatus: 'pass' },
          { name: 'Rear Left Tire', defaultStatus: 'pass' },
          { name: 'Rear Right Tire', defaultStatus: 'pass' },
          { name: 'Spare Tire', defaultStatus: 'pass' },
          { name: 'Wheel Condition', defaultStatus: 'pass' },
          { name: 'Alignment (Visual)', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Brakes',
        icon: '🛑',
        items: [
          { name: 'Front Brake Pads', defaultStatus: 'pass' },
          { name: 'Rear Brake Pads', defaultStatus: 'pass' },
          { name: 'Rotors Condition', defaultStatus: 'pass' },
          { name: 'Brake Fluid', defaultStatus: 'pass' },
          { name: 'Parking Brake', defaultStatus: 'pass' },
          { name: 'ABS System', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Engine',
        icon: '⚙️',
        items: [
          { name: 'Oil Level & Condition', defaultStatus: 'pass' },
          { name: 'Coolant Level & Condition', defaultStatus: 'pass' },
          { name: 'Transmission Fluid', defaultStatus: 'pass' },
          { name: 'Power Steering Fluid', defaultStatus: 'pass' },
          { name: 'Belts & Hoses', defaultStatus: 'pass' },
          { name: 'Leaks (Oil/Coolant)', defaultStatus: 'pass' },
          { name: 'Engine Noise', defaultStatus: 'pass' },
          { name: 'Idle Quality', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Battery & Electrical',
        icon: '🔋',
        items: [
          { name: 'Battery Test', defaultStatus: 'pass' },
          { name: 'Alternator Output', defaultStatus: 'pass' },
          { name: 'All Lights Working', defaultStatus: 'pass' },
          { name: 'Warning Lights', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Suspension & Steering',
        icon: '🚗',
        items: [
          { name: 'Shocks/Struts', defaultStatus: 'pass' },
          { name: 'Steering Play', defaultStatus: 'pass' },
          { name: 'Ball Joints', defaultStatus: 'pass' },
          { name: 'Tie Rods', defaultStatus: 'pass' },
          { name: 'CV Axles/Boots', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Underbody & Frame',
        icon: '🔩',
        items: [
          { name: 'Frame Condition', defaultStatus: 'pass' },
          { name: 'Subframe', defaultStatus: 'pass' },
          { name: 'Exhaust System', defaultStatus: 'pass' },
          { name: 'Fuel Lines', defaultStatus: 'pass' },
          { name: 'Undercoating', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Road Test',
        icon: '🛣️',
        items: [
          { name: 'Engine Performance', defaultStatus: 'pass' },
          { name: 'Transmission Shifting', defaultStatus: 'pass' },
          { name: 'Brake Feel', defaultStatus: 'pass' },
          { name: 'Steering Response', defaultStatus: 'pass' },
          { name: 'Suspension Feel', defaultStatus: 'pass' },
          { name: 'Noises/Vibrations', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Scan Results',
        icon: '📊',
        items: [
          { name: 'Current DTCs', defaultStatus: 'pass' },
          { name: 'Pending DTCs', defaultStatus: 'pass' },
          { name: 'History DTCs', defaultStatus: 'pass' },
          { name: 'Readiness Monitors', defaultStatus: 'pass' }
        ]
      },
      {
        name: 'Documentation',
        icon: '📄',
        items: [
          { name: 'VIN Verification', defaultStatus: 'pass' },
          { name: 'Title Status', defaultStatus: 'n/a' },
          { name: 'Service Records', defaultStatus: 'n/a' }
        ]
      }
    ]
  }
};

// =============================================
// STATUS DEFINITIONS
// =============================================

export const INSPECTION_STATUSES = {
  pass: {
    key: 'pass',
    label: 'Pass',
    color: '#10b981',
    bgColor: '#dcfce7',
    borderColor: '#10b981',
    icon: '✓'
  },
  attention: {
    key: 'attention',
    label: 'Attention',
    color: '#f59e0b',
    bgColor: '#fef3c7',
    borderColor: '#f59e0b',
    icon: '—'
  },
  fail: {
    key: 'fail',
    label: 'Fail',
    color: '#ef4444',
    bgColor: '#fee2e2',
    borderColor: '#ef4444',
    icon: '!'
  },
  'n/a': {
    key: 'n/a',
    label: 'N/A',
    color: '#6b7280',
    bgColor: '#f3f4f6',
    borderColor: '#d1d5db',
    icon: 'N/A'
  }
};

// =============================================
// PRIORITY DEFINITIONS
// =============================================

export const INSPECTION_PRIORITIES = {
  low: {
    key: 'low',
    label: 'Low',
    color: '#6b7280',
    description: 'Monitor, no immediate action needed'
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    color: '#f59e0b',
    description: 'Should be addressed soon'
  },
  high: {
    key: 'high',
    label: 'High',
    color: '#ef4444',
    description: 'Needs immediate attention'
  }
};

// =============================================
// GRADE DEFINITIONS
// =============================================

export const INSPECTION_GRADES = {
  A: {
    grade: 'A',
    label: 'Excellent',
    color: '#10b981',
    bgColor: '#dcfce7',
    description: 'No issues found'
  },
  B: {
    grade: 'B',
    label: 'Good',
    color: '#22c55e',
    bgColor: '#dcfce7',
    description: 'Minor items to monitor'
  },
  C: {
    grade: 'C',
    label: 'Fair',
    color: '#f59e0b',
    bgColor: '#fef3c7',
    description: 'Some items need attention'
  },
  D: {
    grade: 'D',
    label: 'Poor',
    color: '#f97316',
    bgColor: '#ffedd5',
    description: 'Multiple issues found'
  },
  F: {
    grade: 'F',
    label: 'Critical',
    color: '#ef4444',
    bgColor: '#fee2e2',
    description: 'Urgent repairs needed'
  }
};

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Get a template by ID
 * @param {string} templateId 
 * @returns {object|null}
 */
export function getTemplateById(templateId) {
  return INSPECTION_TEMPLATES[templateId] || null;
}

/**
 * Get all available templates as array
 * @returns {Array}
 */
export function getAllTemplates() {
  return Object.values(INSPECTION_TEMPLATES);
}

/**
 * Create a fresh inspection from a template
 * @param {string} templateId 
 * @returns {object} - sections array ready for use
 */
export function createInspectionFromTemplate(templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    console.warn(`Template ${templateId} not found, using standard_dvi`);
    return createInspectionFromTemplate('standard_dvi');
  }

  // Deep clone the template sections and add item-level tracking
  return template.sections.map((section, sectionIndex) => ({
    name: section.name,
    icon: section.icon,
    sectionIndex,
    items: section.items.map((item, itemIndex) => ({
      name: item.name,
      itemIndex,
      status: item.defaultStatus || 'pass',
      priority: null,
      notes: '',
      mediaIds: []
    }))
  }));
}

/**
 * Calculate counts from sections data
 * @param {Array} sections 
 * @returns {object} - { failCount, attentionCount, passCount, highPriorityCount }
 */
export function calculateCounts(sections) {
  let failCount = 0;
  let attentionCount = 0;
  let passCount = 0;
  let highPriorityCount = 0;

  sections.forEach(section => {
    (section.items || []).forEach(item => {
      switch (item.status) {
        case 'fail':
          failCount++;
          if (item.priority === 'high') highPriorityCount++;
          break;
        case 'attention':
          attentionCount++;
          if (item.priority === 'high') highPriorityCount++;
          break;
        case 'pass':
          passCount++;
          break;
      }
    });
  });

  return { failCount, attentionCount, passCount, highPriorityCount };
}

/**
 * Calculate grade from counts
 * @param {object} counts 
 * @param {boolean} unsafeToDrive 
 * @returns {string} - A, B, C, D, or F
 */
export function calculateGrade(counts, unsafeToDrive = false) {
  const { failCount, highPriorityCount } = counts;

  if (unsafeToDrive) return 'F';
  if (failCount === 0 && highPriorityCount === 0) return 'A';
  if (failCount === 0 && highPriorityCount >= 1 && highPriorityCount <= 2) return 'B';
  if (failCount === 1 || (highPriorityCount >= 3 && highPriorityCount <= 5)) return 'C';
  if (failCount >= 2 && failCount <= 3) return 'D';
  return 'F';
}

/**
 * Get status info by key
 * @param {string} statusKey 
 * @returns {object}
 */
export function getStatusInfo(statusKey) {
  return INSPECTION_STATUSES[statusKey] || INSPECTION_STATUSES['n/a'];
}

/**
 * Get grade info by grade letter
 * @param {string} grade 
 * @returns {object}
 */
export function getGradeInfo(grade) {
  return INSPECTION_GRADES[grade] || INSPECTION_GRADES['C'];
}

// Export for global access if needed
if (typeof window !== 'undefined') {
  window.INSPECTION_TEMPLATES = INSPECTION_TEMPLATES;
  window.INSPECTION_STATUSES = INSPECTION_STATUSES;
  window.INSPECTION_PRIORITIES = INSPECTION_PRIORITIES;
  window.INSPECTION_GRADES = INSPECTION_GRADES;
}
