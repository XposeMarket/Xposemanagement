/**
 * pages/appointments.js
 * Appointments page - List, CRUD, Status management
 * 
 * Handles:
 * - Loading appointments from Supabase (data.appointments JSONB)
 * - Creating, editing, deleting appointments
 * - Status management
 * - Search and filtering
 * - Customer save integration with automatic vehicle save
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { getUUID } from '../helpers/uuid.js';

// Current appointment being edited
let currentApptId = null;
let currentApptForStatus = null;
let allAppointments = [];
// Sorting state for appointments table
let apptSortCol = 'created';
let apptSortDir = 'desc'; // 'asc' | 'desc'

// Status options
const STATUSES = ['new', 'scheduled', 'in_progress', 'awaiting_parts', 'completed'];

// Format a time string (HH:MM or HH:MM:SS or ISO) to a 12-hour clock like "2:30 PM".
function formatTime12(timeStr) {
  if (!timeStr) return null;
  try {
    // If already contains AM/PM, assume it's formatted
    if (/(am|pm)$/i.test(timeStr) || /AM|PM/.test(timeStr)) return timeStr;

    // Handle simple HH:MM or HH:MM:SS
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) || 0;
      const s = parts[2] ? parseInt(parts[2], 10) : 0;
      if (!isNaN(h) && !isNaN(m)) {
        const d = new Date();
        d.setHours(h, m, s, 0);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      }
    }

    // Fallback: try Date parsing
    const d = new Date(timeStr);
    if (!isNaN(d)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (e) {
    // ignore and fallback to raw
  }
  return timeStr;
}

// Auto-transition settings: how long to keep status 'new' for platform-created appts
const NEW_STATUS_TIMEOUT_MS = 1000 * 60 * 60; // 1 hour

/**
 * Check appointments and transition platform-created ones from 'new' -> 'scheduled'
 * if they were created more than NEW_STATUS_TIMEOUT_MS ago and they have a schedule.
 */
async function checkAndTransitionNewAppointments(appointments = allAppointments) {
  if (!appointments || !appointments.length) return;
  const now = Date.now();
  let changed = false;
  let transitionedCount = 0;

  for (const appt of appointments) {
    try {
      if (!appt) continue;
      // Only transition appointments created in-platform
      if ((appt.source || '').toLowerCase() !== 'platform') continue;
      if ((appt.status || '').toLowerCase() !== 'new') continue;

      // Must have a scheduled date/time to transition
      if (!appt.preferred_date && !appt.preferred_time) continue;

      const created = appt.created_at ? new Date(appt.created_at).getTime() : 0;
      if (!created) continue;

      if (created + NEW_STATUS_TIMEOUT_MS <= now) {
        appt.status = 'scheduled';
        appt.updated_at = new Date().toISOString();
        changed = true;
        transitionedCount++;
      }
    } catch (e) {
      console.warn('Failed to evaluate appointment for auto-transition', appt, e);
    }
  }

  if (changed) {
    await saveAppointments(appointments);
    console.log(`Auto-transitioned ${transitionedCount} appointment(s) from 'new' to 'scheduled'.`);
  }
}

// Vehicle data for dropdowns with year ranges
const VEHICLE_DATA = {
  'Acura': {
    years: [1990, 2025],
    models: {
      'CL': [1997, 2003],
      'ILX': [2013, 2025],
      'Integra': [1990, 2001],
      'Legend': [1990, 1995],
      'MDX': [2001, 2025],
      'NSX': [1991, 2005],
      'RDX': [2007, 2025],
      'RL': [1996, 2012],
      'RLX': [2014, 2025],
      'RSX': [2002, 2006],
      'TL': [1996, 2014],
      'TLX': [2015, 2025],
      'TSX': [2004, 2014],
      'ZDX': [2010, 2013]
    }
  },
  'Audi': {
    years: [1990, 2025],
    models: {
      'A3': [1997, 2025],
      'A4': [1995, 2025],
      'A5': [2008, 2025],
      'A6': [1994, 2025],
      'A7': [2011, 2025],
      'A8': [1994, 2025],
      'Q3': [2012, 2025],
      'Q5': [2009, 2025],
      'Q7': [2006, 2025],
      'Q8': [2010, 2025],
      'R8': [2007, 2025],
      'S3': [1999, 2025],
      'S4': [1992, 2025],
      'S5': [2008, 2025],
      'S6': [1995, 2025],
      'S7': [2013, 2025],
      'S8': [1995, 2025],
      'SQ5': [2013, 2025],
      'TT': [1999, 2025]
    }
  },
  'BMW': {
    years: [1990, 2025],
    models: {
      '1 Series': [2004, 2025],
      '2 Series': [2014, 2025],
      '3 Series': [1990, 2025],
      '4 Series': [2014, 2025],
      '5 Series': [1990, 2025],
      '6 Series': [1990, 2025],
      '7 Series': [1990, 2025],
      '8 Series': [1990, 2025],
      'M2': [2016, 2025],
      'M3': [1990, 2025],
      'M4': [2014, 2025],
      'M5': [1990, 2025],
      'M6': [1990, 2025],
      'M8': [1990, 2025],
      'X1': [2010, 2025],
      'X2': [2018, 2025],
      'X3': [2004, 2025],
      'X4': [2015, 2025],
      'X5': [2000, 2025],
      'X6': [2008, 2025],
      'X7': [2019, 2025],
      'Z3': [1996, 2002],
      'Z4': [2003, 2025]
    }
  },
  'Buick': {
    years: [1990, 2025],
    models: {
      'Cascada': [2016, 2019],
      'Enclave': [2008, 2025],
      'Encore': [2013, 2025],
      'Envision': [2016, 2025],
      'LaCrosse': [2005, 2025],
      'Lucerne': [2006, 2011],
      'Rainier': [2004, 2007],
      'Regal': [1990, 2025],
      'Rendezvous': [2002, 2007],
      'Terraza': [2005, 2007],
      'Verano': [2012, 2017]
    }
  },
  'Cadillac': {
    years: [1990, 2025],
    models: {
      'ATS': [2013, 2019],
      'BLS': [2006, 2009],
      'CT4': [2020, 2025],
      'CT5': [2020, 2025],
      'CT6': [2016, 2025],
      'CTS': [2003, 2019],
      'DeVille': [1990, 2005],
      'DTS': [2006, 2011],
      'Eldorado': [1990, 2002],
      'Escalade': [1999, 2025],
      'Fleetwood': [1990, 1996],
      'Seville': [1990, 2004],
      'SRX': [2004, 2016],
      'STS': [2005, 2011],
      'XLR': [2004, 2009],
      'XT4': [2019, 2025],
      'XT5': [2017, 2025],
      'XT6': [2020, 2025],
      'XTS': [2013, 2019]
    }
  },
  'Chevrolet': {
    years: [1990, 2025],
    models: {
      'Avalanche': [2002, 2013],
      'Aveo': [2004, 2011],
      'Blazer': [1995, 2025],
      'Bolt': [2017, 2025],
      'Camaro': [1993, 2025],
      'Caprice': [1990, 1996],
      'Captiva': [2012, 2015],
      'Cavalier': [1990, 2005],
      'Chevelle': [1990, 1990], // Limited production in 1990
      'Cobalt': [2005, 2010],
      'Colorado': [2004, 2025],
      'Corvette': [1990, 2025],
      'Cruze': [2011, 2025],
      'Equinox': [2005, 2025],
      'Express': [1997, 2025],
      'HHR': [2006, 2011],
      'Impala': [1994, 2025],
      'Malibu': [1997, 2025],
      'Monte Carlo': [1995, 2007],
      'Silverado': [1999, 2025],
      'Sonic': [2012, 2020],
      'Spark': [2013, 2025],
      'Suburban': [1992, 2025],
      'Tahoe': [1995, 2025],
      'Trailblazer': [2002, 2009],
      'Traverse': [2009, 2025],
      'Trax': [2015, 2025],
      'Uplander': [2005, 2008],
      'Volt': [2011, 2019]
    }
  },
  'Chrysler': {
    years: [1990, 2025],
    models: {
      '200': [2011, 2017],
      '300': [2005, 2025],
      'Aspen': [2007, 2009],
      'Concorde': [1993, 2004],
      'Crossfire': [2004, 2008],
      'Imperial': [1990, 1993],
      'LeBaron': [1990, 1995],
      'LHS': [1994, 2001],
      'Neon': [1995, 2005],
      'Pacifica': [2004, 2025],
      'PT Cruiser': [2001, 2010],
      'Sebring': [1995, 2010],
      'Town & Country': [1990, 2025],
      'Voyager': [2001, 2003]
    }
  },
  'Dodge': {
    years: [1990, 2025],
    models: {
      'Avenger': [1995, 2014],
      'Caliber': [2007, 2012],
      'Caravan': [1990, 2025],
      'Challenger': [2008, 2025],
      'Charger': [2006, 2025],
      'Colt': [1990, 1994],
      'Dakota': [1990, 2011],
      'Dart': [2013, 2016],
      'Durango': [1998, 2025],
      'Grand Caravan': [1990, 2025],
      'Intrepid': [1993, 2004],
      'Journey': [2009, 2020],
      'Magnum': [2005, 2008],
      'Neon': [1995, 2005],
      'Ram': [1994, 2025],
      'Shadow': [1990, 1994],
      'Spirit': [1990, 1995],
      'Sprinter': [2003, 2009],
      'Stealth': [1991, 1996],
      'Stratus': [1995, 2006],
      'Viper': [1992, 2017]
    }
  },
  'Ford': {
    years: [1990, 2025],
    models: {
      'Bronco': [1990, 2025],
      'C-Max': [2013, 2018],
      'Contour': [1995, 2000],
      'Crown Victoria': [1992, 2011],
      'E-Series': [1992, 2025],
      'EcoSport': [2018, 2025],
      'Edge': [2007, 2025],
      'Escape': [2001, 2025],
      'Excursion': [2000, 2005],
      'Expedition': [1997, 2025],
      'Explorer': [1991, 2025],
      'F-150': [1997, 2025],
      'F-250': [1999, 2025],
      'F-350': [1999, 2025],
      'Fiesta': [2011, 2025],
      'Five Hundred': [2005, 2007],
      'Flex': [2009, 2019],
      'Focus': [2000, 2025],
      'Freestar': [2004, 2007],
      'Freestyle': [2005, 2009],
      'Fusion': [2006, 2025],
      'GT': [2005, 2025],
      'Mustang': [1994, 2025],
      'Ranger': [1993, 2011],
      'Taurus': [1990, 2019],
      'Thunderbird': [2002, 2005],
      'Transit': [2015, 2025],
      'Windstar': [1995, 2003]
    }
  },
  'GMC': {
    years: [1990, 2025],
    models: {
      'Acadia': [2007, 2025],
      'Canyon': [2004, 2012],
      'Envoy': [1998, 2009],
      'Jimmy': [1990, 2005],
      'Safari': [1990, 2005],
      'Savana': [1996, 2025],
      'Sierra': [1999, 2025],
      'Sonoma': [1991, 2004],
      'Suburban': [1992, 2025],
      'Terrain': [2010, 2025],
      'Yukon': [1992, 2025],
      'Yukon XL': [2000, 2025]
    }
  },
  'Honda': {
    years: [1990, 2025],
    models: {
      'Accord': [1990, 2025],
      'Civic': [1990, 2025],
      'Clarity': [2017, 2025],
      'CR-V': [1997, 2025],
      'CR-Z': [2011, 2016],
      'Crosstour': [2010, 2015],
      'Element': [2003, 2011],
      'Fit': [2007, 2020],
      'HR-V': [2015, 2025],
      'Insight': [2000, 2025],
      'Odyssey': [1995, 2025],
      'Passport': [1994, 2002],
      'Pilot': [2003, 2025],
      'Prelude': [1990, 2001],
      'Ridgeline': [2006, 2025],
      'S2000': [2000, 2009]
    }
  },
  'Hyundai': {
    years: [1990, 2025],
    models: {
      'Accent': [1995, 2025],
      'Azera': [2006, 2017],
      'Elantra': [1992, 2025],
      'Entourage': [2007, 2009],
      'Equus': [2011, 2016],
      'Genesis': [2009, 2016],
      'Ioniq': [2017, 2025],
      'Kona': [2018, 2025],
      'Nexo': [2018, 2025],
      'Palisade': [2019, 2025],
      'Santa Fe': [2001, 2025],
      'Sonata': [1990, 2025],
      'Tucson': [2005, 2025],
      'Veloster': [2012, 2025],
      'Venue': [2020, 2025],
      'Veracruz': [2007, 2012]
    }
  },
  'Infiniti': {
    years: [1990, 2025],
    models: {
      'EX': [2010, 2013],
      'FX': [2003, 2013],
      'G': [1991, 2013],
      'I': [1996, 2002],
      'JX': [2013, 2014],
      'M': [2003, 2013],
      'Q': [2014, 2025],
      'QX': [2014, 2025]
    }
  },
  'Jeep': {
    years: [1990, 2025],
    models: {
      'Cherokee': [1990, 2025],
      'Comanche': [1990, 1992],
      'Commander': [2006, 2010],
      'Compass': [2007, 2025],
      'Gladiator': [2020, 2025],
      'Grand Cherokee': [1993, 2025],
      'Liberty': [2002, 2012],
      'Patriot': [2007, 2017],
      'Renegade': [2015, 2025],
      'Wrangler': [1990, 2025]
    }
  },
  'Kia': {
    years: [1990, 2025],
    models: {
      'Amanti': [2004, 2009],
      'Borrego': [2009, 2011],
      'Cadenza': [2010, 2025],
      'Carnival': [1999, 2025],
      'Forte': [2010, 2025],
      'K5': [2021, 2025],
      'K900': [2014, 2025],
      'Niro': [2017, 2025],
      'Optima': [2001, 2025],
      'Rio': [2001, 2025],
      'Sedona': [2002, 2025],
      'Seltos': [2020, 2025],
      'Sorento': [2003, 2025],
      'Soul': [2009, 2025],
      'Spectra': [2000, 2009],
      'Sportage': [1995, 2025],
      'Stinger': [2018, 2025],
      'Telluride': [2019, 2025]
    }
  },
  'Lexus': {
    years: [1990, 2025],
    models: {
      'CT': [2011, 2025],
      'ES': [1990, 2025],
      'GS': [1993, 2025],
      'GX': [2003, 2025],
      'HS': [2010, 2012],
      'IS': [1999, 2025],
      'LC': [2018, 2025],
      'LS': [1990, 2025],
      'LX': [1996, 2025],
      'NX': [2015, 2025],
      'RC': [2015, 2025],
      'RX': [1998, 2025],
      'SC': [1992, 2000],
      'UX': [2019, 2025]
    }
  },
  'Lincoln': {
    years: [1990, 2025],
    models: {
      'Aviator': [2003, 2025],
      'Blackwood': [2002, 2002],
      'Continental': [1990, 2025],
      'Corsair': [2020, 2025],
      'LS': [2000, 2006],
      'Mark LT': [2006, 2008],
      'MKC': [2015, 2019],
      'MKS': [2009, 2016],
      'MKT': [2010, 2019],
      'MKX': [2007, 2018],
      'MKZ': [2007, 2025],
      'Nautilus': [2019, 2025],
      'Navigator': [1998, 2025],
      'Town Car': [1990, 2011],
      'Zephyr': [2006, 2006]
    }
  },
  'Mazda': {
    years: [1990, 2025],
    models: {
      '2': [2003, 2025],
      '3': [2004, 2025],
      '5': [2006, 2010],
      '6': [2003, 2025],
      '626': [1990, 2002],
      'B-Series': [1990, 2009],
      'CX-3': [2016, 2025],
      'CX-30': [2020, 2025],
      'CX-5': [2013, 2025],
      'CX-7': [2007, 2012],
      'CX-9': [2007, 2025],
      'Mazda2': [2011, 2025],
      'Mazda3': [2004, 2025],
      'Mazda5': [2006, 2010],
      'Mazda6': [2003, 2025],
      'Mazdaspeed3': [2007, 2013],
      'Mazdaspeed6': [2006, 2007],
      'Miata': [1990, 2025],
      'MPV': [1990, 2006],
      'MX-5': [1990, 2025],
      'Protege': [1990, 2003],
      'RX-7': [1990, 2002],
      'RX-8': [2003, 2011],
      'Tribute': [2001, 2006]
    }
  },
  'Mercedes-Benz': {
    years: [1990, 2025],
    models: {
      'A-Class': [1997, 2025],
      'B-Class': [2005, 2025],
      'C-Class': [1994, 2025],
      'CL-Class': [1998, 2014],
      'CLA': [2014, 2025],
      'CLK': [1998, 2010],
      'CLS': [2005, 2025],
      'E-Class': [1990, 2025],
      'G-Class': [1990, 2025],
      'GL-Class': [2007, 2016],
      'GLA': [2014, 2025],
      'GLB': [2019, 2025],
      'GLC': [2016, 2025],
      'GLE': [2016, 2025],
      'GLK': [2010, 2015],
      'GLS': [2016, 2025],
      'M-Class': [1998, 2015],
      'ML': [1998, 2015],
      'R-Class': [2006, 2013],
      'S-Class': [1990, 2025],
      'SL': [1990, 2025],
      'SLC': [2016, 2025],
      'SLK': [1996, 2025],
      'SLS': [2010, 2014],
      'Sprinter': [2007, 2025]
    }
  },
  'Mercury': {
    years: [1990, 2025],
    models: {
      'Cougar': [1990, 2002],
      'Grand Marquis': [1990, 2011],
      'Marauder': [2003, 2004],
      'Mariner': [2005, 2011],
      'Milan': [2006, 2011],
      'Montego': [2005, 2007],
      'Monterey': [2004, 2007],
      'Mountaineer': [1997, 2010],
      'Mystique': [1995, 2000],
      'Sable': [1990, 2009],
      'Villager': [1993, 2002]
    }
  },
  'Mitsubishi': {
    years: [1990, 2025],
    models: {
      '3000GT': [1991, 2000],
      'Diamante': [1992, 2004],
      'Eclipse': [1990, 2012],
      'Endeavor': [2004, 2011],
      'Galant': [1990, 2012],
      'i-MiEV': [2011, 2013],
      'Lancer': [2002, 2025],
      'Mirage': [2014, 2025],
      'Montero': [1990, 2006],
      'Outlander': [2003, 2025],
      'Raider': [2006, 2009],
      'Sigma': [1990, 1990]
    }
  },
  'Nissan': {
    years: [1990, 2025],
    models: {
      '240SX': [1990, 1998],
      '300ZX': [1990, 2000],
      '350Z': [2003, 2009],
      '370Z': [2009, 2025],
      'Altima': [1993, 2025],
      'Armada': [2004, 2015],
      'Cube': [2009, 2014],
      'Frontier': [1998, 2025],
      'GT-R': [2009, 2025],
      'Juke': [2011, 2025],
      'Kicks': [2018, 2025],
      'Leaf': [2011, 2025],
      'Maxima': [1990, 2025],
      'Murano': [2003, 2025],
      'NV': [2012, 2025],
      'NV200': [2013, 2025],
      'Pathfinder': [1990, 2025],
      'Quest': [1993, 2025],
      'Rogue': [2008, 2025],
      'Rogue Sport': [2017, 2025],
      'Sentra': [1990, 2025],
      'Titan': [2004, 2025],
      'Titan XD': [2016, 2025],
      'Versa': [2007, 2025],
      'Xterra': [2000, 2015]
    }
  },
  'Pontiac': {
    years: [1990, 2025],
    models: {
      'Aztek': [2001, 2005],
      'Bonneville': [1990, 2005],
      'Firebird': [1990, 2002],
      'G5': [2005, 2010],
      'G6': [2005, 2010],
      'G8': [2008, 2009],
      'Grand Am': [1990, 2005],
      'Grand Prix': [1990, 2008],
      'GTO': [2004, 2006],
      'Montana': [1999, 2009],
      'Solstice': [2006, 2009],
      'Sunbird': [1990, 1994],
      'Sunfire': [1995, 2005],
      'Torrent': [2006, 2009],
      'Trans Sport': [1990, 1999],
      'Vibe': [2003, 2010]
    }
  },
  'Porsche': {
    years: [1990, 2025],
    models: {
      '718 Boxster': [2016, 2025],
      '718 Cayman': [2016, 2025],
      '718 Spyder': [2016, 2025],
      '911': [1990, 2025],
      '918 Spyder': [2013, 2015],
      '928': [1990, 1995],
      '944': [1990, 1991],
      '968': [1992, 1995],
      'Boxster': [1996, 2025],
      'Carrera GT': [2004, 2006],
      'Cayenne': [2003, 2025],
      'Cayman': [2006, 2025],
      'Macan': [2014, 2025],
      'Panamera': [2010, 2025],
      'Taycan': [2020, 2025]
    }
  },
  'Ram': {
    years: [1990, 2025],
    models: {
      '1500': [1994, 2025],
      '2500': [1994, 2025],
      '3500': [1994, 2025],
      '4500': [2010, 2025],
      '5500': [2010, 2025],
      'Chassis Cab': [2011, 2025],
      'Dakota': [1997, 2011],
      'Promaster': [2014, 2025],
      'Promaster City': [2015, 2025]
    }
  },
  'Saab': {
    years: [1990, 2025],
    models: {
      '3-Sep': [1990, 1993],
      '5-Sep': [1998, 2009],
      '9-2X': [2005, 2006],
      '9-3': [1999, 2011],
      '9-4X': [2011, 2016],
      '9-5': [1998, 2010],
      '9-7X': [2005, 2009]
    }
  },
  'Saturn': {
    years: [1991, 2010],
    models: {
      'Astra': [2008, 2009],
      'Aura': [2007, 2009],
      'Ion': [2003, 2007],
      'L-Series': [2000, 2005],
      'Outlook': [2007, 2010],
      'Relay': [2005, 2007],
      'S-Series': [1991, 2002],
      'Sky': [2007, 2009],
      'VUE': [2002, 2010]
    }
  },
  'Scion': {
    years: [2004, 2016],
    models: {
      'FR-S': [2013, 2016],
      'iA': [2016, 2016],
      'iM': [2016, 2016],
      'iQ': [2012, 2015],
      'tC': [2005, 2010],
      'xA': [2004, 2006],
      'xB': [2008, 2015],
      'xD': [2008, 2014]
    }
  },
  'Subaru': {
    years: [1990, 2025],
    models: {
      'Ascent': [2019, 2025],
      'B9 Tribeca': [2006, 2008],
      'BRZ': [2013, 2025],
      'Crosstrek': [2013, 2025],
      'Forester': [1998, 2025],
      'Impreza': [1993, 2025],
      'Legacy': [1990, 2025],
      'Outback': [1995, 2025],
      'STI': [2018, 2025],
      'Tribeca': [2006, 2008],
      'WRX': [2015, 2025],
      'XV Crosstrek': [2013, 2025]
    }
  },
  'Suzuki': {
    years: [1990, 2025],
    models: {
      'Aerio': [2002, 2007],
      'Equator': [2009, 2012],
      'Forenza': [2004, 2008],
      'Grand Vitara': [1999, 2013],
      'Kizashi': [2010, 2013],
      'Reno': [2005, 2008],
      'SX4': [2007, 2013],
      'Verona': [2004, 2006],
      'Vitara': [1999, 2003],
      'XL-7': [2000, 2009]
    }
  },
  'Tesla': {
    years: [2008, 2025],
    models: {
      'Model 3': [2017, 2025],
      'Model S': [2012, 2025],
      'Model X': [2016, 2025],
      'Model Y': [2020, 2025],
      'Roadster': [2008, 2025]
    }
  },
  'Toyota': {
    years: [1990, 2025],
    models: {
      '4Runner': [1990, 2025],
      '86': [2013, 2025],
      'Avalon': [1995, 2025],
      'Camry': [1990, 2025],
      'Celica': [1990, 2005],
      'Corolla': [1990, 2025],
      'Cressida': [1990, 1992],
      'Echo': [2000, 2005],
      'FJ Cruiser': [2007, 2025],
      'GR86': [2022, 2025],
      'Highlander': [2001, 2025],
      'Land Cruiser': [1990, 2025],
      'Matrix': [2003, 2013],
      'Mirai': [2016, 2025],
      'MR2': [1990, 2007],
      'Paseo': [1992, 1999],
      'Prius': [2001, 2025],
      'RAV4': [1996, 2025],
      'Sequoia': [2001, 2025],
      'Sienna': [1998, 2025],
      'Solara': [1999, 2008],
      'Supra': [1993, 2025],
      'Tacoma': [1995, 2025],
      'Tundra': [2000, 2025],
      'Venza': [2009, 2015],
      'Yaris': [2007, 2025]
    }
  },
  'Volkswagen': {
    years: [1990, 2025],
    models: {
      'Arteon': [2019, 2025],
      'Atlas': [2018, 2025],
      'Beetle': [1998, 2025],
      'CC': [2009, 2017],
      'Eos': [2007, 2015],
      'Golf': [1990, 2025],
      'GTI': [1990, 2025],
      'ID.4': [2021, 2025],
      'Jetta': [1990, 2025],
      'Passat': [1990, 2025],
      'Phaeton': [2004, 2006],
      'Rabbit': [2006, 2009],
      'Routan': [2009, 2013],
      'Tiguan': [2008, 2025],
      'Touareg': [2004, 2025]
    }
  },
  'Volvo': {
    years: [1990, 2025],
    models: {
      '240': [1990, 1993],
      '740': [1990, 1992],
      '850': [1993, 1997],
      '940': [1990, 1998],
      '960': [1990, 1998],
      'C30': [2007, 2013],
      'C70': [1998, 2013],
      'S40': [2004, 2011],
      'S60': [2001, 2025],
      'S70': [1997, 2000],
      'S80': [1999, 2006],
      'S90': [2017, 2025],
      'V40': [2013, 2019],
      'V50': [2004, 2012],
      'V60': [2015, 2025],
      'V70': [2000, 2007],
      'V90': [2017, 2025],
      'XC40': [2018, 2025],
      'XC60': [2009, 2025],
      'XC70': [2003, 2016],
      'XC90': [2003, 2025]
    }
  }
};

// Expose VEHICLE_DATA to the global window so other components
// (e.g. Parts Finder) can reuse the same vehicle catalog
if (typeof window !== 'undefined') {
  window.VEHICLE_DATA = window.VEHICLE_DATA || VEHICLE_DATA;
}

/**
 * Populate vehicle year dropdown
 */
function populateVehicleYears(selectElement) {
  const currentYear = new Date().getFullYear();
  selectElement.innerHTML = '<option value="">Select Year</option>';
  
  for (let year = currentYear; year >= 1990; year--) {
    const option = document.createElement('option');
    option.value = year.toString();
    option.textContent = year.toString();
    selectElement.appendChild(option);
  }
}

/**
 * Populate vehicle make dropdown, filtered by selected year
 */
function populateVehicleMakes(selectElement, yearSelect = null) {
  const selectedYear = yearSelect ? parseInt(yearSelect.value) : null;
  selectElement.innerHTML = '<option value="">Select Make</option>';
  
  Object.keys(VEHICLE_DATA).sort().forEach(make => {
    // If a year is selected, only include makes that were available in that year
    if (selectedYear && VEHICLE_DATA[make].years) {
      const [startYear, endYear] = VEHICLE_DATA[make].years;
      if (selectedYear < startYear || selectedYear > endYear) {
        return; // Skip this make if it wasn't available in the selected year
      }
    }
    
    const option = document.createElement('option');
    option.value = make;
    option.textContent = make;
    selectElement.appendChild(option);
  });
}

/**
 * Populate vehicle model dropdown based on selected make and year
 */
function populateVehicleModels(makeSelect, modelSelect, yearSelect = null) {
  const selectedMake = makeSelect.value;
  const selectedYear = yearSelect ? parseInt(yearSelect.value) : null;
  modelSelect.innerHTML = '<option value="">Select Model</option>';
  
  if (selectedMake && VEHICLE_DATA[selectedMake] && VEHICLE_DATA[selectedMake].models) {
    Object.keys(VEHICLE_DATA[selectedMake].models).sort().forEach(model => {
      // If a year is selected, only include models that were available in that year
      if (selectedYear && VEHICLE_DATA[selectedMake].models[model]) {
        const [startYear, endYear] = VEHICLE_DATA[selectedMake].models[model];
        if (selectedYear < startYear || selectedYear > endYear) {
          return; // Skip this model if it wasn't available in the selected year
        }
      }
      
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
  }
}

/**
 * Get current user's shop ID
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get current user info
 */
function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.find(u => u.email === session.email) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Save or update vehicle in Supabase vehicles table
 */
async function upsertVehicleToSupabase(customerId, shopId, vehicleData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    // Get year, make, model from separate fields
    const year = vehicleData.vehicle_year || vehicleData.year || '';
    const make = vehicleData.vehicle_make || vehicleData.make || '';
    const model = vehicleData.vehicle_model || vehicleData.model || '';
    
    // Check if vehicle already exists for this customer (by VIN if available)
    let existingVehicle = null;
    
    if (vehicleData.vin) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('vin', vehicleData.vin)
        .single();
      
      if (vinMatch) existingVehicle = vinMatch;
    }
    
    // If no VIN match, try matching by year/make/model
    if (!existingVehicle && year && make && model) {
      const { data: ymmMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('year', year)
        .eq('make', make)
        .eq('model', model)
        .single();
      
      if (ymmMatch) existingVehicle = ymmMatch;
    }
    
    const vehiclePayload = {
      id: existingVehicle?.id || getUUID(),
      customer_id: customerId,
      shop_id: shopId,
      vin: vehicleData.vin || '',
      year: year,
      make: make,
      model: model,
      trim: vehicleData.trim || '',
      plate: vehicleData.plate || '',
      vehicle_notes: vehicleData.vehicle_notes || '',
      is_primary: existingVehicle ? existingVehicle.is_primary : true, // First vehicle is primary
      created_at: existingVehicle?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('vehicles')
      .upsert(vehiclePayload, { onConflict: 'id' })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error upserting vehicle:', error);
      return null;
    }
    
    console.log('✅ Vehicle upserted to vehicles table:', data);
    return data;
  } catch (err) {
    console.error('❌ Exception upserting vehicle:', err);
    return null;
  }
}

/**
 * Save or update customer in Supabase customers table
 * Also saves vehicle to vehicles table if provided
 */
async function upsertCustomerToSupabase(customerData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const shopId = getCurrentShopId();
    if (!shopId) return null;
    // Check if customer already exists by phone/email in this shop
    let existingCustomer = null;
    if (customerData.phone) {
      const { data: phoneMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('phone', customerData.phone)
        .maybeSingle();
      if (phoneMatch) existingCustomer = phoneMatch;
    }
    if (!existingCustomer && customerData.email) {
      const { data: emailMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('email', customerData.email)
        .maybeSingle();
      if (emailMatch) existingCustomer = emailMatch;
    }
    // Standardize customer fields
    customerData.customer_id = existingCustomer?.id || customerData.customer_id || getUUID();
    // Always fill customer_first and customer_last from appointment info, fallback to splitting combined customer string
    if (!customerData.customer_first || !customerData.customer_last) {
      if (customerData.customer) {
        const nameParts = customerData.customer.trim().split(' ');
        customerData.customer_first = customerData.customer_first || nameParts[0] || '';
        customerData.customer_last = customerData.customer_last || nameParts.slice(1).join(' ') || '';
      }
    }
    if (!customerData.customer_first || !customerData.customer_last) {
      console.error('❌ upsertCustomerToSupabase: customer_first or customer_last is blank!', customerData);
      throw new Error('customer_first and customer_last must not be blank');
    }
    // No fallback to 'Unknown' -- if blank, will remain blank and should be caught as a bug
    // Only use existingCustomer if both phone/email and name match
    let customerId;
    if (existingCustomer &&
        existingCustomer.customer_first === customerData.customer_first &&
        existingCustomer.customer_last === customerData.customer_last) {
      customerId = existingCustomer.id;
    } else {
      customerId = getUUID();
    }
    const customerPayload = {
      id: customerId,
      shop_id: shopId,
      customer_first: customerData.customer_first,
      customer_last: customerData.customer_last,
      email: customerData.email || '',
      phone: customerData.phone || '',
      // Only include a simple vehicle string on the customers row. Structured vehicle
      // fields are saved to the `vehicles` table via `upsertVehicleToSupabase` below.
      vehicle: customerData.vehicle || '',
      zipcode: customerData.zipcode || '',
      notes: customerData.notes || '',
      created_at: existingCustomer?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    // Payload prepared for upsert (debug logging removed)
    const { data, error } = await supabase
      .from('customers')
      .upsert(customerPayload, { onConflict: 'id' })
      .select()
      .single();
    if (error) {
      try {
        console.error('❌ Error upserting customer:', error, JSON.stringify(error));
      } catch (e) {
        console.error('❌ Error upserting customer (could not stringify):', error);
      }
      // If Supabase returned a detailed message, log it for debugging
      if (error?.message || error?.details) {
        console.error('Supabase error message:', error.message, 'details:', error.details);
      }
      return null;
    }
    console.log('✅ Customer upserted to customers table:', data);
    // Save vehicle with correct customer_id
    if (customerData.vehicle || customerData.vin) {
      await upsertVehicleToSupabase(customerId, shopId, customerData);
    }
    return data;
  } catch (err) {
    console.error('❌ Exception upserting customer:', err);
    return null;
  }
}

/**
 * Load appointments from Supabase
 */
async function loadAppointments() {
  const shopId = getCurrentShopId();
  if (!shopId) {
    console.warn('No shop ID found');
    return [];
  }

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Load from Supabase data table
      const { data, error } = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error) {
        console.warn('Error loading appointments from Supabase:', error);
        throw error;
      }
      
      const appts = data?.appointments || [];
      // Ensure customer_first and customer_last are set for each appointment
      appts.forEach(appt => {
        if ((!appt.customer_first || !appt.customer_last) && appt.customer) {
          const nameParts = appt.customer.trim().split(' ');
          appt.customer_first = nameParts[0] || '';
          appt.customer_last = nameParts.slice(1).join(' ') || '';
        }
      });
      // Fix customer names from customer_id if available
      try {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        const customerMap = new Map(customers?.map(c => [c.id, c]) || []);
        appts.forEach(appt => {
          if (appt.customer_id && customerMap.has(appt.customer_id)) {
            const cust = customerMap.get(appt.customer_id);
            appt.customer_first = cust.customer_first;
            appt.customer_last = cust.customer_last;
          }
          // Also fix if customer_first is a UUID
          if (appt.customer_first && /^[0-9a-f-]{36}$/.test(appt.customer_first) && customerMap.has(appt.customer_first)) {
            const cust = customerMap.get(appt.customer_first);
            appt.customer_first = cust.customer_first;
            appt.customer_last = cust.customer_last;
          }
          // Also fix if customer is a UUID
          if (appt.customer && /^[0-9a-f-]{36}$/.test(appt.customer) && customerMap.has(appt.customer)) {
            const cust = customerMap.get(appt.customer);
            appt.customer = `${cust.customer_first} ${cust.customer_last}`.trim();
          }
        });
      } catch (e) {
        console.warn('[appointments.js] Could not fix customer names:', e);
      }
      return appts;
    }
  } catch (ex) {
    console.warn('Supabase load failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    const appts = (localData.appointments || []).filter(a => a.shop_id === shopId);
    appts.forEach(appt => {
      if ((!appt.customer_first || !appt.customer_last) && appt.customer) {
        const nameParts = appt.customer.trim().split(' ');
        appt.customer_first = nameParts[0] || '';
        appt.customer_last = nameParts.slice(1).join(' ') || '';
      }
    });
    return appts;
  } catch (e) {
    return [];
  }
}

/**
 * Save appointments to Supabase
 */
async function saveAppointments(appointments) {
  const shopId = getCurrentShopId();
  if (!shopId) return false;

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows
        throw fetchError;
      }
      
      // Upsert with appointments
      const payload = {
        shop_id: shopId,
        appointments: appointments,
        settings: currentData?.settings || {},
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      
      // Also insert/update appointments in appointments table
      for (const appt of appointments) {
        // Skip appointments with old string IDs (not UUIDs)
        if (appt.id.includes('_')) {
          console.log('Skipping upsert for old appointment ID:', appt.id);
          continue;
        }
        // Use customer_first and customer_last directly
        const customer_first = appt.customer_first || '';
        const customer_last = appt.customer_last || '';
        
        // DON'T auto-upsert customer - only save customer when explicitly requested
        // Customer should only be saved via the "Save Customer" button
        
        // Save appointment with customer info (but no customer_id auto-linkage)
        const apptPayload = {
          id: appt.id,
          shop_id: shopId,
          customer_id: appt.customer_id || null,
          customer_first,
          customer_last,
          email: appt.email || '',
          phone: appt.phone || '',
          vehicle: appt.vehicle || '',
          vin: appt.vin || '',
          service: appt.service || '',
          preferred_date: appt.preferred_date || null,
          preferred_time: appt.preferred_time || null,
          status: appt.status || 'new',
          source: appt.source || 'walk-in',
          created_at: appt.created_at,
          updated_at: appt.updated_at
        };
        const { error: apptError } = await supabase
          .from('appointments')
          .upsert(apptPayload, { onConflict: 'id' });
        if (apptError) {
          console.error('Failed to upsert appointment:', apptError);
        }
      }
      
      console.log('✅ Appointments saved to Supabase');
      return true;
    }
  } catch (ex) {
    console.warn('Supabase save failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.appointments = localData.appointments || [];
    
    // Remove old appointments for this shop
    localData.appointments = localData.appointments.filter(a => a.shop_id !== shopId);
    
    // Add new appointments
    localData.appointments.push(...appointments);
    
    localStorage.setItem('xm_data', JSON.stringify(localData));
    console.log('✅ Appointments saved to localStorage');
    return true;
  } catch (e) {
    console.error('Failed to save appointments:', e);
    return false;
  }
}

/**
 * Render appointments table
 */
function renderAppointments(appointments = allAppointments) {
  const tbody = document.querySelector('#apptTable tbody');
  const empty = document.getElementById('apptEmpty');
  
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (appointments.length === 0) {
    if (empty) empty.textContent = 'No appointments found.';
    return;
  }
  
  if (empty) empty.textContent = '';
  
  // Apply sorting based on header clicks
  const sorted = [...appointments].sort((a, b) => {
    const col = apptSortCol;
    const dir = apptSortDir === 'asc' ? 1 : -1;
    let va, vb;
    switch (col) {
      case 'created':
        va = new Date(a.created_at || 0).getTime();
        vb = new Date(b.created_at || 0).getTime();
        break;
      case 'customer':
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
        break;
      case 'vehicle':
        va = (a.vehicle || '').toLowerCase(); vb = (b.vehicle || '').toLowerCase();
        break;
      case 'service':
        va = (a.service || '').toLowerCase(); vb = (b.service || '').toLowerCase();
        break;
      case 'scheduled':
        va = new Date(a.preferred_date || 0).getTime(); vb = new Date(b.preferred_date || 0).getTime();
        break;
      case 'time':
        // compare preferred_date first then preferred_time
        va = (a.preferred_date || '') + ' ' + (a.preferred_time || '');
        vb = (b.preferred_date || '') + ' ' + (b.preferred_time || '');
        break;
      case 'status':
        va = (a.status || '').toLowerCase(); vb = (b.status || '').toLowerCase();
        break;
      default:
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
    }

    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  
  sorted.forEach(appt => {
    const tr = document.createElement('tr');
    tr.dataset.apptId = appt.id;
    // On mobile, make row clickable to open view modal
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      tr.classList.add('appt-row-clickable');
      tr.addEventListener('click', (e) => {
        // Only trigger if not clicking a button inside the row
        if (e.target.closest('button')) return;
        openViewModal(appt);
      });
    }
    
    // Created date
    const tdCreated = document.createElement('td');
    try {
      const c = new Date(appt.created_at);
      const dateStr = c.toLocaleDateString();
      const timeStr = c.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      tdCreated.innerHTML = `<div class="stacked-datetime"><span class="dt-date">${dateStr}</span><span class="dt-time">${timeStr}</span></div>`;
    } catch (e) {
      tdCreated.textContent = appt.created_at || '';
    }
    tr.appendChild(tdCreated);
    
    // Customer
    const tdCustomer = document.createElement('td');
    if (appt.customer_first || appt.customer_last) {
      tdCustomer.textContent = `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim();
    } else {
      tdCustomer.textContent = appt.customer || 'N/A';
    }
    tr.appendChild(tdCustomer);
    
    // Vehicle
    const tdVehicle = document.createElement('td');
    tdVehicle.textContent = appt.vehicle || 'N/A';
    tr.appendChild(tdVehicle);
    
    // Service
    const tdService = document.createElement('td');
    tdService.textContent = appt.service || 'N/A';
    tr.appendChild(tdService);
    
    // Scheduled (date only)
    const tdDate = document.createElement('td');
    if (appt.preferred_date) {
      try {
        // Parse as local date if format is YYYY-MM-DD
        let dateStr = appt.preferred_date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(appt.preferred_date)) {
          const [y, m, d] = appt.preferred_date.split('-').map(Number);
          const localDate = new Date(y, m - 1, d);
          dateStr = localDate.toLocaleDateString();
        } else {
          // fallback for other formats
          const d = new Date(appt.preferred_date);
          dateStr = d.toLocaleDateString();
        }
        tdDate.textContent = dateStr;
      } catch (e) {
        tdDate.textContent = appt.preferred_date;
      }
    } else {
      tdDate.textContent = 'Not set';
    }
    tr.appendChild(tdDate);
    
    // Time
    const tdTime = document.createElement('td');
    tdTime.textContent = appt.preferred_time ? formatTime12(appt.preferred_time) : 'Not set';
    tr.appendChild(tdTime);
    
    // Status
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${getStatusClass(appt.status)}`;
    statusSpan.textContent = appt.status || 'new';
    statusSpan.style.cursor = 'pointer';
    statusSpan.title = 'Click to change status';
    statusSpan.addEventListener('click', () => openStatusModal(appt));
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);
    
    // Actions (2x2 grid: view/invoice on top row, edit/delete on bottom)
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'appt-actions-grid';

    // View button (top-left)
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => openViewModal(appt));
    actionsDiv.appendChild(viewBtn);

    // Open Invoice button (top-right)
    const invoiceBtn = document.createElement('button');
    invoiceBtn.className = 'btn small secondary';
    invoiceBtn.textContent = 'Invoice';
    invoiceBtn.title = 'Open related invoice';
    invoiceBtn.addEventListener('click', () => {
      // Find invoice for this appointment
      const invoices = JSON.parse(localStorage.getItem('xm_data') || '{}').invoices || [];
      const inv = invoices.find(i => i.appointment_id === appt.id);
      if (inv) {
        // Store invoice id in session for modal open
        localStorage.setItem('openInvoiceId', inv.id);
        window.location.href = 'invoices.html';
      } else {
        // No invoice found — create one automatically and open it
        createInvoiceForAppointment(appt).then(newInv => {
          if (newInv && newInv.id) {
            localStorage.setItem('openInvoiceId', newInv.id);
            window.location.href = 'invoices.html';
          } else {
            alert('Failed to create invoice for this appointment.');
          }
        }).catch(err => {
          console.error('Error creating invoice for appointment:', err);
          alert('Failed to create invoice for this appointment.');
        });
      }
    });
    actionsDiv.appendChild(invoiceBtn);

    // Edit button (bottom-left)
    const editBtn = document.createElement('button');
    // Use the blue "info" style for Edit to match New/Edit buttons
    editBtn.className = 'btn small info';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(appt));
    actionsDiv.appendChild(editBtn);

  // Delete button (bottom-right) — use a compact white trash icon to fit current size
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn small danger';
  deleteBtn.setAttribute('aria-label', 'Delete appointment');
  // Inline SVG trash icon (white fill) sized to match text
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
  deleteBtn.addEventListener('click', () => showDeleteApptModal(appt.id));
  actionsDiv.appendChild(deleteBtn);

    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  // Return the raw status string to match .tag.[status] CSS classes
  // For legacy or alternate status names, map as needed
  if (status === 'done') return 'completed';
  return status || 'new';
}

// --- Services & Suggestions ---
let _svcCache = null;
async function loadServices() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    let services = [];
    if (supabase && shopId) {
      try {
        const { data, error } = await supabase.from('data').select('settings').eq('shop_id', shopId).single();
        if (!error && data && data.settings && Array.isArray(data.settings.services)) {
          services = data.settings.services;
        }
      } catch (e) {
        // fallthrough to localStorage
      }
    }

    if (!services.length) {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      services = (data.settings && data.settings.services) || [];
    }

    _svcCache = services;
    populateSvcOptions(services);
  } catch (ex) {
    console.error('Error loading services for suggestions:', ex);
  }
}

function populateSvcOptions(services) {
  try {
    const dl = document.getElementById('svcOptions');
    if (!dl) return;
    dl.innerHTML = '';
    (services || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name || '';
      dl.appendChild(opt);
    });
  } catch (e) { console.warn(e); }
}

/**
 * Add a service item to the invoice associated with an appointment (if exists)
 */
async function addServiceToInvoice(apptId, serviceName) {
  if (!apptId || !serviceName) return;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // find service price from cache or settings
  let price = 0;
  if (!_svcCache) await loadServices();
  const svc = (_svcCache || []).find(s => s.name === serviceName);
  if (svc) price = parseFloat(svc.price) || 0;

  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for adding service to invoice:', fetchError);
        return;
      }

      const invoices = currentData?.invoices || [];
      const inv = invoices.find(i => i.appointment_id === apptId);
      if (!inv) return; // nothing to update

      inv.items = inv.items || [];
      // Avoid duplicates of same service name
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }

      // Upsert data record
      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Upsert invoice to invoices table
      const invoicePayload = {
        id: inv.id,
        shop_id: shopId,
        number: inv.number,
        customer: inv.customer || '',
        customer_first: inv.customer_first || '',
        customer_last: inv.customer_last || '',
        appointment_id: inv.appointment_id || null,
        job_id: inv.job_id || null,
        status: inv.status || 'open',
        due: inv.due || null,
        tax_rate: inv.tax_rate || 6,
        discount: inv.discount || 0,
        items: inv.items || [],
        paid_date: inv.paid_date || null,
        created_at: inv.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await supabase.from('invoices').upsert(invoicePayload, { onConflict: 'id' });
      console.log('Added service to invoice', inv.id, serviceName);
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      const inv = data.invoices.find(i => i.appointment_id === apptId);
      if (!inv) return;
      inv.items = inv.items || [];
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Added service to local invoice', inv.id, serviceName);
    }
  } catch (ex) {
    console.error('Failed to add service to invoice:', ex);
  }
}

/**
 * Create a blank invoice for an appointment (includes customer/shop info and optionally the service as an item)
 */
async function createInvoiceForAppointment(appt) {
  if (!appt || !appt.id) return null;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // Compose invoice object
  const id = getUUID();
  // Generate a sequential invoice number to match Jobs flow (fallback to 1001+)
  let number;
  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('invoices').eq('shop_id', shopId).single();
      if (!fetchError) {
        const invoices = currentData?.invoices || [];
        const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
        number = String(maxNumber + 1);
      } else {
        // fall back to timestamp if fetch failed
        number = `INV-${Date.now().toString().slice(-6)}`;
      }
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      number = String(maxNumber + 1);
    }
  } catch (e) {
    console.error('Error generating invoice number:', e);
    number = `INV-${Date.now().toString().slice(-6)}`;
  }
  const customer = appt.customer || '';
  const nameParts = (customer || '').trim().split(' ');
  const customer_first = nameParts[0] || '';
  const customer_last = nameParts.slice(1).join(' ') || '';
  // Lookup customer ID
  let customer_id = '';
  try {
    if (supabase && shopId) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, customer_first, customer_last, phone, email')
        .eq('shop_id', shopId);
      const match = customers?.find(c =>
        (c.customer_first?.trim().toLowerCase() === customer_first?.trim().toLowerCase()) &&
        (c.customer_last?.trim().toLowerCase() === customer_last?.trim().toLowerCase())
      ) || customers?.find(c => c.phone === appt.phone) || customers?.find(c => c.email === appt.email);
      if (match) customer_id = match.id;
    }
  } catch (e) {
    console.warn('[appointments.js] Could not lookup customer ID:', e);
  }
  // Attempt to get service price
  let items = [];
  if (appt.service) {
    if (!_svcCache) await loadServices();
    const svc = (_svcCache || []).find(s => s.name === appt.service);
    const price = svc ? (parseFloat(svc.price) || 0) : 0;
    items.push({ name: appt.service, qty: 1, price: price, type: 'part' });
  }

  const inv = {
    id,
    shop_id: shopId,
    number,
    customer,
    customer_id,
    customer_first,
    customer_last,
    appointment_id: appt.id,
    job_id: null,
    status: 'open',
    due: null,
    tax_rate: 6,
    discount: 0,
    items,
    paid_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    if (supabase && shopId) {
      // Upsert into data table
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for invoice creation:', fetchError);
      }

      const invoices = currentData?.invoices || [];
      invoices.push(inv);

      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Also insert into invoices table
      const { error: upsertError } = await supabase.from('invoices').upsert(inv, { onConflict: 'id' });
      if (upsertError) console.warn('Error upserting invoice to invoices table:', upsertError);

      console.log('Created invoice for appointment (supabase):', inv.id);
      return inv;
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      data.invoices.push(inv);
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Created invoice for appointment (local):', inv.id);
      return inv;
    }
  } catch (ex) {
    console.error('Failed to create invoice for appointment:', ex);
    return null;
  }
}

// UUID generation is now imported from helpers/uuid.js

/**
 * Open view modal
 */
function openViewModal(appt) {
  const modal = document.getElementById('viewApptModal');
  const content = document.getElementById('viewApptContent');
  const editBtn = document.getElementById('editFromViewBtn');
  
  if (!modal || !content) return;
  
  content.innerHTML = `
    <div style="display: grid; gap: 12px;">
      <div><strong>Customer:</strong> ${appt.customer || 'N/A'}</div>
      <div><strong>Phone:</strong> ${appt.phone || 'N/A'}</div>
      <div><strong>Email:</strong> ${appt.email || 'N/A'}</div>
      <div><strong>Vehicle:</strong> ${appt.vehicle || 'N/A'}</div>
      ${appt.vin ? `<div><strong>VIN:</strong> ${appt.vin}</div>` : ''}
      <div><strong>Service:</strong> ${appt.service || 'N/A'}</div>
      <div><strong>Date:</strong> ${appt.preferred_date ? new Date(appt.preferred_date).toLocaleDateString() : 'Not set'}</div>
      <div><strong>Time:</strong> ${appt.preferred_time ? formatTime12(appt.preferred_time) : 'Not set'}</div>
      <div><strong>Status:</strong> <span class="tag ${getStatusClass(appt.status)}">${appt.status || 'new'}</span></div>
      ${appt.notes ? `<div><strong>Notes:</strong><br>${appt.notes}</div>` : ''}
    </div>
  `;
  
  editBtn.onclick = () => {
    modal.classList.add('hidden');
    openEditModal(appt);
  };
  
  modal.classList.remove('hidden');
}

/**
 * Close view modal
 */
function closeViewModal() {
  const modal = document.getElementById('viewApptModal');
  if (modal) modal.classList.add('hidden');
}

// Make it global for onclick
window.closeViewApptModal = closeViewModal;

/**
 * Open status modal
 */
function openStatusModal(appt) {
  currentApptForStatus = appt;
  const modal = document.getElementById('statusModal');
  const pillsContainer = document.getElementById('statusPills');
  
  if (!modal || !pillsContainer) return;
  
  pillsContainer.innerHTML = '';
  
  STATUSES.forEach(status => {
    const pill = document.createElement('button');
    pill.className = `btn ${appt.status === status ? getStatusClass(status) : ''}`;
    pill.textContent = status.replace(/_/g, ' ').toUpperCase();
    pill.style.width = '100%';
    pill.style.textAlign = 'left';
    
    pill.addEventListener('click', async () => {
      await updateAppointmentStatus(appt.id, status);
      modal.classList.add('hidden');
    });
    
    pillsContainer.appendChild(pill);
  });
  
  modal.classList.remove('hidden');
}

/**
 * Close status modal
 */
function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  if (modal) modal.classList.add('hidden');
  currentApptForStatus = null;
}

// Make it global for onclick
window.closeStatusModal = closeStatusModal;

/**
 * Update appointment status
 */
async function updateAppointmentStatus(apptId, newStatus) {
  const index = allAppointments.findIndex(a => a.id === apptId);
  if (index === -1) return;
  
  allAppointments[index].status = newStatus;
  allAppointments[index].updated_at = new Date().toISOString();

  await saveAppointments(allAppointments);
  renderAppointments();

  // Auto-create or update job if status is in_progress or awaiting_parts
  if (['in_progress', 'awaiting_parts'].includes(newStatus)) {
    const appt = allAppointments[index];
    // Load jobs from localStorage
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    // Check if job already exists for this appointment
    let job = jobs.find(j => j.appointment_id === appt.id);
    if (!job) {
      job = {
        id: getUUID(),
        shop_id: appt.shop_id,
        appointment_id: appt.id,
        customer: appt.customer || '',
        customer_first: appt.customer_first || '',
        customer_last: appt.customer_last || '',
        assigned_to: null,
        status: newStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(job);
    } else {
      job.status = newStatus;
      job.updated_at = new Date().toISOString();
    }
    // Save jobs to localStorage
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job created/updated for appointment', appt.id);
    } catch (e) {
      console.error('Failed to save job:', e);
    }
    // Also sync jobs to Supabase
    try {
      const { saveJobs } = await import('./jobs.js');
      await saveJobs(jobs);
      console.log('✅ Jobs synced to Supabase');
    } catch (e) {
      console.error('Failed to sync jobs to Supabase:', e);
    }
  } else {
    // If status is not active, remove job from jobs
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    const appt = allAppointments[index];
    jobs = jobs.filter(j => j.appointment_id !== appt.id);
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job removed for appointment', appt.id);
    } catch (e) {
      console.error('Failed to remove job:', e);
    }
    // Also sync jobs to Supabase
    try {
      const { saveJobs } = await import('./jobs.js');
      await saveJobs(jobs);
      console.log('✅ Jobs synced to Supabase');
    } catch (e) {
      console.error('Failed to sync jobs to Supabase:', e);
    }
  }

  showNotification(`Status updated to ${newStatus}`);
}

/**
 * Open new appointment modal
 */
function openNewModal() {
  const modal = document.getElementById('newApptModal');
  if (!modal) return;
  // Check localStorage for newApptCustomer and newApptVehicle
  let customer = null;
  let vehicle = null;
  try {
    customer = JSON.parse(localStorage.getItem('newApptCustomer') || 'null');
  } catch (e) {}
  try {
    vehicle = JSON.parse(localStorage.getItem('newApptVehicle') || 'null');
  } catch (e) {}
  // Populate fields if available
  document.getElementById('naFirst').value = customer?.customer_first || '';
  document.getElementById('naLast').value = customer?.customer_last || '';
  document.getElementById('naEmail').value = customer?.email || '';
  document.getElementById('naPhone').value = customer?.phone || '';
  document.getElementById('naVehicleYear').value = vehicle?.year || customer?.vehicle_year || '';
  document.getElementById('naVehicleMake').value = vehicle?.make || customer?.vehicle_make || '';
  document.getElementById('naVehicleModel').value = vehicle?.model || customer?.vehicle_model || '';
  // Populate model dropdown based on selected make
  const naMakeSelect = document.getElementById('naVehicleMake');
  const naModelSelect = document.getElementById('naVehicleModel');
  const naYearSelect = document.getElementById('naVehicleYear');
  if (naMakeSelect.value) {
    populateVehicleModels(naMakeSelect, naModelSelect, naYearSelect);
    naModelSelect.value = vehicle?.model || customer?.vehicle_model || '';
  }
  document.getElementById('naVin').value = vehicle?.vin || '';
  document.getElementById('naService').value = '';
  document.getElementById('naDate').value = '';
  document.getElementById('naTime').value = '';
  // Clear localStorage after use
  localStorage.removeItem('newApptCustomer');
  localStorage.removeItem('newApptVehicle');
  modal.classList.remove('hidden');
  document.getElementById('naFirst').focus();
}

/**
 * Close new appointment modal
 */
function closeNewModal() {
  const modal = document.getElementById('newApptModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Save new appointment
 */
async function saveNewAppointment() {
  const first = document.getElementById('naFirst').value.trim();
  const last = document.getElementById('naLast').value.trim();
  const email = document.getElementById('naEmail').value.trim();
  const phone = document.getElementById('naPhone').value.trim();
  const vehicle_year = document.getElementById('naVehicleYear').value.trim();
  const vehicle_make = document.getElementById('naVehicleMake').value.trim();
  const vehicle_model = document.getElementById('naVehicleModel').value.trim();
  const vehicle = [vehicle_year, vehicle_make, vehicle_model].filter(v => v).join(' ') || '';
  const vin = document.getElementById('naVin').value.trim();
  const service = document.getElementById('naService').value.trim();
  const date = document.getElementById('naDate').value;
  const time = document.getElementById('naTime').value;
  const newAppt = {
    id: getUUID(),
    shop_id: getCurrentShopId(),
    customer: `${first} ${last}`,
    customer_first: first,
    customer_last: last,
    email,
    phone,
    vehicle,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vin,
    service,
    preferred_date: date || null,
    preferred_time: time || null,
    status: 'new',
    source: 'platform',
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  allAppointments.push(newAppt);
  await saveAppointments(allAppointments);
  // If there's an invoice for this appointment, add the chosen service to it
  await addServiceToInvoice(newAppt.id, newAppt.service);
  
  // After save, run auto-transition in case other appointments need updating
  await checkAndTransitionNewAppointments(allAppointments);

  closeNewModal();
  renderAppointments();
  showNotification('Appointment created successfully!');
}

/**
 * Open edit modal
 */
function openEditModal(appt) {
  currentApptId = appt.id;
  const modal = document.getElementById('apptModal');
  const form = document.getElementById('apptForm');
  const title = document.getElementById('apptModalTitle');
  
  if (!modal || !form) return;
  
  title.textContent = 'Edit Appointment';
  
  // Populate form
  // Always populate customer_first and customer_last, falling back to splitting combined customer string
  let first = appt.customer_first;
  let last = appt.customer_last;
  if ((!first || !last) && appt.customer) {
    const nameParts = appt.customer.trim().split(' ');
    first = first || nameParts[0] || '';
    last = last || nameParts.slice(1).join(' ') || '';
  }
  form.elements['customer_first'].value = first || '';
  form.elements['customer_last'].value = last || '';
  form.elements['phone'].value = appt.phone || '';
  form.elements['email'].value = appt.email || '';
  
  // Handle vehicle data - use separate fields if available, otherwise parse combined vehicle string
  let vehicle_year = appt.vehicle_year || '';
  let vehicle_make = appt.vehicle_make || '';
  let vehicle_model = appt.vehicle_model || '';
  
  if (!vehicle_year && !vehicle_make && !vehicle_model && appt.vehicle) {
    // Parse the combined vehicle string for backward compatibility
    const vehicleParts = appt.vehicle.trim().split(/\s+/);
    if (vehicleParts.length >= 1 && /^\d{4}$/.test(vehicleParts[0])) {
      vehicle_year = vehicleParts.shift();
    }
    if (vehicleParts.length >= 1) {
      vehicle_make = vehicleParts.shift();
    }
    if (vehicleParts.length >= 1) {
      vehicle_model = vehicleParts.join(' ');
    }
  }
  
  form.elements['vehicle_year'].value = vehicle_year;
  form.elements['vehicle_make'].value = vehicle_make;
  form.elements['vehicle_model'].value = vehicle_model;
  
  // Populate model dropdown based on selected make
  const makeSelect = form.elements['vehicle_make'];
  const modelSelect = form.elements['vehicle_model'];
  const yearSelect = form.elements['vehicle_year'];
  if (makeSelect.value) {
    populateVehicleModels(makeSelect, modelSelect, yearSelect);
    modelSelect.value = vehicle_model;
  }
  
  form.elements['vin'].value = appt.vin || '';
  form.elements['service'].value = appt.service || '';
  form.elements['preferred_date'].value = appt.preferred_date || '';
  form.elements['preferred_time'].value = appt.preferred_time || '';
  form.elements['notes'].value = appt.notes || '';
  
  modal.classList.remove('hidden');
}

/**
 * Close edit modal
 */
function closeEditModal() {
  const modal = document.getElementById('apptModal');
  if (modal) modal.classList.add('hidden');
  currentApptId = null;
}

/**
 * Save edited appointment
 */
async function saveEditedAppointment(e) {
  if (e) e.preventDefault();
  
  if (!currentApptId) return;
  
  const form = document.getElementById('apptForm');
  const index = allAppointments.findIndex(a => a.id === currentApptId);
  
  if (index === -1) return;
  
  const customer_first = form.elements['customer_first'].value.trim();
  const customer_last = form.elements['customer_last'].value.trim();

  const vehicle_year = form.elements['vehicle_year'].value.trim();
  const vehicle_make = form.elements['vehicle_make'].value.trim();
  const vehicle_model = form.elements['vehicle_model'].value.trim();
  const vehicle = [vehicle_year, vehicle_make, vehicle_model].filter(v => v).join(' ') || '';

  allAppointments[index] = {
    ...allAppointments[index],
    customer: `${customer_first} ${customer_last}`.trim(),
    customer_first,
    customer_last,
    phone: form.elements['phone'].value.trim(),
    email: form.elements['email'].value.trim(),
    vehicle,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vin: form.elements['vin'].value.trim(),
    service: form.elements['service'].value.trim(),
    preferred_date: form.elements['preferred_date'].value || null,
    preferred_time: form.elements['preferred_time'].value || null,
    notes: form.elements['notes'].value.trim(),
    updated_at: new Date().toISOString()
  };

  await saveAppointments(allAppointments);

  // 🆕 Update customer in customers table (with vehicle)
  // NOTE: Do NOT auto-upsert customers when saving/editing an appointment.
  // Customers should only be created/updated when the user explicitly
  // clicks the "Save Customer" button in the UI. The Save Customer
  // button already delegates to `upsertCustomerToSupabase()`.
  // If there's an invoice linked to this appointment, ensure the service is added
  await addServiceToInvoice(currentApptId, allAppointments[index].service);
  
  closeEditModal();
  renderAppointments();
  showNotification('Appointment updated successfully!');
}

/**
 * Delete appointment
 */

let pendingDeleteApptId = null;

async function showDeleteApptModal(apptId) {
  pendingDeleteApptId = apptId;
  const modal = document.getElementById('deleteApptModal');
  const msgEl = document.getElementById('deleteApptMsg');
  if (modal) {
    // Count related records
    let jobCount = 0;
    let invoiceCount = 0;
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id')
          .eq('appointment_id', apptId);
        jobCount = jobs?.length || 0;
        
        if (jobCount > 0) {
          const jobIds = jobs.map(j => j.id);
          const { data: invs } = await supabase
            .from('invoices')
            .select('id')
            .or(`appointment_id.eq.${apptId},job_id.in.(${jobIds.join(',')})`);
          invoiceCount = invs?.length || 0;
        } else {
          const { data: invs } = await supabase
            .from('invoices')
            .select('id')
            .eq('appointment_id', apptId);
          invoiceCount = invs?.length || 0;
        }
      } catch (e) {
        console.warn('Error counting related records:', e);
      }
    }
    
    if (msgEl) {
      let msg = 'Delete this appointment?';
      if (jobCount > 0 || invoiceCount > 0) {
        msg += ` This will also delete ${jobCount} related job(s) and ${invoiceCount} related invoice(s).`;
      }
      msgEl.textContent = msg;
    }
    
    modal.classList.remove('hidden');
  }
}

function hideDeleteApptModal() {
  pendingDeleteApptId = null;
  const modal = document.getElementById('deleteApptModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeleteAppointment() {
  if (!pendingDeleteApptId) return;
  
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  if (supabase && shopId) {
    try {
      // Find related jobs
      const { data: relatedJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('appointment_id', pendingDeleteApptId);
      
      // Find related invoices (by appointment_id or job_id)
      let relatedInvoices = [];
      if (relatedJobs && relatedJobs.length > 0) {
        const jobIds = relatedJobs.map(j => j.id);
        const { data: invs } = await supabase
          .from('invoices')
          .select('id')
          .or(`appointment_id.eq.${pendingDeleteApptId},job_id.in.(${jobIds.join(',')})`);
        relatedInvoices = invs || [];
      } else {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id')
          .eq('appointment_id', pendingDeleteApptId);
        relatedInvoices = invs || [];
      }
      
      // Load current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // Delete related invoices from table
      for (const inv of relatedInvoices) {
        await supabase
          .from('invoices')
          .delete()
          .eq('id', inv.id);
        console.log('✅ Related invoice deleted:', inv.id);
      }
      
      // Delete related jobs from table
      for (const job of relatedJobs || []) {
        await supabase
          .from('jobs')
          .delete()
          .eq('id', job.id);
        console.log('✅ Related job deleted:', job.id);
      }
      
      // Update data table: remove related jobs and invoices
      const allJobs = currentData?.jobs || [];
      const updatedJobs = allJobs.filter(j => j.appointment_id !== pendingDeleteApptId);
      const allInvoices = currentData?.invoices || [];
      const updatedInvoices = allInvoices.filter(inv => 
        inv.appointment_id !== pendingDeleteApptId && 
        !relatedJobs.some(j => j.id === inv.job_id)
      );
      
      await supabase
        .from('data')
        .upsert({
          shop_id: shopId,
          jobs: updatedJobs,
          invoices: updatedInvoices,
          settings: currentData?.settings || {},
          appointments: currentData?.appointments || [],
          threads: currentData?.threads || []
        });
      
      // Delete the appointment
      await supabase
        .from('appointments')
        .delete()
        .eq('id', pendingDeleteApptId);
      console.log('✅ Appointment deleted from Supabase:', pendingDeleteApptId);
    } catch (e) {
      console.error('Error deleting appointment and related records from Supabase:', e);
    }
  }
  
  // Remove from local array
  allAppointments = allAppointments.filter(a => a.id !== pendingDeleteApptId);
  await saveAppointments(allAppointments);
  renderAppointments();
  showNotification('Appointment and related jobs/invoices deleted');
  hideDeleteApptModal();
}

/**
 * Apply filters
 */
function applyFilters() {
  const searchTerm = document.getElementById('apptSearch').value.toLowerCase();
  const statusFilter = document.getElementById('apptStatus').value;
  
  let filtered = [...allAppointments];
  
  if (searchTerm) {
    filtered = filtered.filter(a => 
      (a.customer || '').toLowerCase().includes(searchTerm) ||
      (a.vehicle || '').toLowerCase().includes(searchTerm) ||
      (a.service || '').toLowerCase().includes(searchTerm) ||
      (a.phone || '').includes(searchTerm)
    );
  }
  
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  
  renderAppointments(filtered);
}

/**
 * Show notification
 */
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  if (!notification) return;
  
  notification.textContent = message;
  notification.className = 'notification';
  
  if (type === 'error') {
    notification.style.background = '#ef4444';
  } else {
    notification.style.background = '#10b981';
  }
  
  notification.classList.remove('hidden');
  
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 3000);
}

/**
 * Setup appointments page
 */
async function setupAppointments() {
  console.log('📅 Setting up Appointments page...');
  
  // Load appointments
  allAppointments = await loadAppointments();
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  // Load services for suggestions
  await loadServices();
  // Auto-transition any platform-created 'new' appointments older than configured timeout
  await checkAndTransitionNewAppointments(allAppointments);
  
  // Render initial table
  renderAppointments();
  
  // Event listeners
  const newBtn = document.getElementById('newAppt');
  if (newBtn) newBtn.addEventListener('click', openNewModal);
  
  const closeNewBtn = document.getElementById('closeAppt');
  if (closeNewBtn) closeNewBtn.addEventListener('click', closeNewModal);
  
  const saveNewBtn = document.getElementById('saveAppt');
  if (saveNewBtn) saveNewBtn.addEventListener('click', saveNewAppointment);
  
  const closeEditBtn = document.getElementById('closeApptModal');
  if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
  
  const saveEditBtn = document.getElementById('saveApptEdit');
  if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditedAppointment);
  
  const apptForm = document.getElementById('apptForm');
  if (apptForm) apptForm.addEventListener('submit', saveEditedAppointment);
  
  const filterBtn = document.getElementById('apptFilter');
  if (filterBtn) filterBtn.addEventListener('click', applyFilters);
  
  const searchInput = document.getElementById('apptSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      // Real-time search
      setTimeout(applyFilters, 300);
    });
  }

  // Make headers sortable
  try {
    document.querySelectorAll('#apptTable thead th.sortable').forEach(h => {
      h.style.cursor = 'pointer';
      h.addEventListener('click', () => {
        const col = h.dataset.col;
        if (!col) return;
        if (apptSortCol === col) apptSortDir = apptSortDir === 'asc' ? 'desc' : 'asc';
        else { apptSortCol = col; apptSortDir = 'asc'; }
        // update header classes
        document.querySelectorAll('#apptTable thead th.sortable').forEach(x => x.classList.remove('asc','desc'));
        h.classList.add(apptSortDir === 'asc' ? 'asc' : 'desc');
        renderAppointments();
      });
    });
  } catch (e) {}
  
  // Check for #new hash
  if (window.location.hash === '#new') {
    openNewModal();
  }
  // Delete modal event listeners
  const deleteModal = document.getElementById('deleteApptModal');
  const deleteModalClose = document.getElementById('deleteApptModalClose');
  const deleteModalCancel = document.getElementById('deleteApptModalCancel');
  const deleteModalConfirm = document.getElementById('deleteApptModalConfirm');
  if (deleteModalClose) deleteModalClose.addEventListener('click', hideDeleteApptModal);
  if (deleteModalCancel) deleteModalCancel.addEventListener('click', hideDeleteApptModal);
  if (deleteModalConfirm) deleteModalConfirm.addEventListener('click', confirmDeleteAppointment);
  if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) hideDeleteApptModal(); });
  
  // Initialize vehicle dropdowns
  const vehicleYearSelect = document.getElementById('vehicleYear');
  const vehicleMakeSelect = document.getElementById('vehicleMake');
  const vehicleModelSelect = document.getElementById('vehicleModel');
  const naVehicleYearSelect = document.getElementById('naVehicleYear');
  const naVehicleMakeSelect = document.getElementById('naVehicleMake');
  const naVehicleModelSelect = document.getElementById('naVehicleModel');
  
  if (vehicleYearSelect) populateVehicleYears(vehicleYearSelect);
  if (vehicleMakeSelect) {
    populateVehicleMakes(vehicleMakeSelect, vehicleYearSelect);
    vehicleMakeSelect.addEventListener('change', () => populateVehicleModels(vehicleMakeSelect, vehicleModelSelect, vehicleYearSelect));
  }
  if (vehicleYearSelect && vehicleMakeSelect) {
    vehicleYearSelect.addEventListener('change', () => {
      populateVehicleMakes(vehicleMakeSelect, vehicleYearSelect);
      populateVehicleModels(vehicleMakeSelect, vehicleModelSelect, vehicleYearSelect);
    });
  }
  
  if (naVehicleYearSelect) populateVehicleYears(naVehicleYearSelect);
  if (naVehicleMakeSelect) {
    populateVehicleMakes(naVehicleMakeSelect, naVehicleYearSelect);
    naVehicleMakeSelect.addEventListener('change', () => populateVehicleModels(naVehicleMakeSelect, naVehicleModelSelect, naVehicleYearSelect));
  }
  if (naVehicleYearSelect && naVehicleMakeSelect) {
    naVehicleYearSelect.addEventListener('change', () => {
      populateVehicleMakes(naVehicleMakeSelect, naVehicleYearSelect);
      populateVehicleModels(naVehicleMakeSelect, naVehicleModelSelect, naVehicleYearSelect);
    });
  }
  
  console.log('✅ Appointments page setup complete');
}

// Export the customer upsert function so it can be used from the modal save buttons
export { setupAppointments, upsertCustomerToSupabase, saveAppointments };
