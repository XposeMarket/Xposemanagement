/**
 * helpers/vin-decoder.js
 * 
 * VIN Decoder using the free NHTSA vPIC API
 * https://vpic.nhtsa.dot.gov/api/
 * 
 * FREE Tier - No API key required
 * Returns: Year, Make, Model, Body Type, Engine Cylinders, Fuel Type (when available)
 */

const NHTSA_API_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

/**
 * Validate VIN format (basic validation)
 * @param {string} vin - The VIN to validate
 * @returns {boolean} - True if VIN appears valid
 */
export function isValidVIN(vin) {
  if (!vin || typeof vin !== 'string') return false;
  const cleanVin = vin.trim().toUpperCase();
  // VINs are exactly 17 characters
  if (cleanVin.length !== 17) return false;
  // VINs don't contain I, O, or Q
  if (/[IOQ]/i.test(cleanVin)) return false;
  // VINs are alphanumeric only
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) return false;
  return true;
}

/**
 * Decode a VIN using the NHTSA vPIC API
 * @param {string} vin - The 17-character VIN
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function decodeVIN(vin) {
  if (!isValidVIN(vin)) {
    return { success: false, error: 'Invalid VIN format. VIN must be exactly 17 characters.' };
  }
  
  const cleanVin = vin.trim().toUpperCase();
  
  try {
    // Use the DecodeVinValues endpoint for JSON response with common data items
    const response = await fetch(`${NHTSA_API_BASE}/DecodeVinValues/${cleanVin}?format=json`);
    
    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check if we got results
    if (!data.Results || data.Results.length === 0) {
      return { success: false, error: 'No vehicle data found for this VIN.' };
    }
    
    const result = data.Results[0];
    
    // Check for error codes in the response
    const errorCode = result.ErrorCode;
    const errorText = result.ErrorText;
    
    // ErrorCode 0 = No errors, 1-5 = various issues but may still have partial data
    // We'll try to extract what we can
    
    // Extract the key fields we need
    const vehicleData = {
      vin: cleanVin,
      year: result.ModelYear || '',
      make: normalizeManufacturerName(result.Make || ''),
      model: result.Model || '',
      trim: result.Trim || '',
      bodyClass: result.BodyClass || '',
      vehicleType: result.VehicleType || '',
      driveType: result.DriveType || '',
      fuelType: result.FuelTypePrimary || '',
      engineCylinders: result.EngineCylinders || '',
      engineSize: result.DisplacementL ? `${result.DisplacementL}L` : '',
      transmissionStyle: result.TransmissionStyle || '',
      doors: result.Doors || '',
      plantCountry: result.PlantCountry || '',
      manufacturer: result.Manufacturer || '',
      // Raw error info for debugging
      _errorCode: errorCode,
      _errorText: errorText
    };
    
    // Validate we got at least Year, Make, and Model
    if (!vehicleData.year || !vehicleData.make || !vehicleData.model) {
      // Still return what we have but flag it
      return {
        success: true,
        partial: true,
        data: vehicleData,
        warning: 'Some vehicle information could not be decoded. Please verify the data.'
      };
    }
    
    return { success: true, data: vehicleData };
    
  } catch (error) {
    console.error('[VIN Decoder] Error:', error);
    return { 
      success: false, 
      error: `Failed to decode VIN: ${error.message}` 
    };
  }
}

/**
 * Normalize manufacturer names to match our VEHICLE_DATA keys
 * The NHTSA API returns various formats like "HONDA", "Honda", "HONDA MOTOR CO."
 * We need to normalize these to match our dropdown options
 */
function normalizeManufacturerName(name) {
  if (!name) return '';
  
  // Title case the name
  let normalized = name.trim()
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  // Handle common variations
  const mappings = {
    // Full company names to short names
    'Honda Motor Company': 'Honda',
    'Honda Motor Co': 'Honda',
    'Toyota Motor Corporation': 'Toyota',
    'Toyota Motor': 'Toyota',
    'Ford Motor Company': 'Ford',
    'Ford Motor': 'Ford',
    'General Motors': 'GM',
    'Gm': 'GM',
    'Bmw': 'BMW',
    'Bmw Of North America': 'BMW',
    'Mercedes-benz': 'Mercedes-Benz',
    'Mercedes Benz': 'Mercedes-Benz',
    'Volkswagen Group': 'Volkswagen',
    'Vw': 'Volkswagen',
    'Fca Us Llc': 'FCA',
    'Chrysler Group Llc': 'Chrysler',
    'Nissan Motor': 'Nissan',
    'Nissan North America': 'Nissan',
    'Hyundai Motor': 'Hyundai',
    'Hyundai Motor Company': 'Hyundai',
    'Kia Motors': 'Kia',
    'Kia Motor Corporation': 'Kia',
    'Subaru Of America': 'Subaru',
    'Fuji Heavy Industries': 'Subaru',
    'Mazda Motor': 'Mazda',
    'Mazda Motor Corporation': 'Mazda',
    'Mitsubishi Motors': 'Mitsubishi',
    'Volvo Car': 'Volvo',
    'Volvo Cars': 'Volvo',
    'Jaguar Land Rover': 'Jaguar',
    'Jlr': 'Jaguar',
    'Tesla Motors': 'Tesla',
    'Tesla Inc': 'Tesla',
    'Porsche Cars': 'Porsche',
    'Dr. Ing. H.c. F. Porsche Ag': 'Porsche',
    'Audi Of America': 'Audi',
    'Audi Ag': 'Audi',
    'Lexus': 'Lexus', // Lexus is typically under Toyota
    'Infiniti': 'Infiniti', // Infiniti is under Nissan
    'Acura': 'Acura', // Acura is under Honda
    'Cadillac': 'Cadillac', // Under GM
    'Chevrolet': 'Chevrolet', // Under GM
    'Gmc': 'GMC',
    'Buick': 'Buick', // Under GM
    'Ram': 'Ram', // Under FCA
    'Dodge': 'Dodge', // Under FCA
    'Jeep': 'Jeep', // Under FCA
    'Lincoln': 'Lincoln', // Under Ford
    'Land Rover': 'Land Rover',
    'Alfa Romeo': 'Alfa Romeo',
    'Maserati': 'Maserati',
    'Ferrari': 'Ferrari',
    'Lamborghini': 'Lamborghini',
    'Bentley': 'Bentley',
    'Rolls-royce': 'Rolls-Royce',
    'Rolls Royce': 'Rolls-Royce',
    'Aston Martin': 'Aston Martin',
    'Mclaren': 'McLaren',
    'Lotus': 'Lotus',
    'Mini': 'MINI',
    'Smart': 'Smart',
    'Fiat': 'Fiat',
    'Genesis': 'Genesis', // Under Hyundai
    'Polestar': 'Polestar', // Under Volvo
    'Rivian': 'Rivian',
    'Lucid': 'Lucid',
  };
  
  // Check for exact match in mappings
  if (mappings[normalized]) {
    return mappings[normalized];
  }
  
  // Check if the name starts with a known manufacturer name
  for (const [key, value] of Object.entries(mappings)) {
    if (normalized.toLowerCase().startsWith(key.toLowerCase())) {
      return value;
    }
  }
  
  return normalized;
}

/**
 * Format the decoded vehicle data for display
 * @param {object} data - The decoded vehicle data
 * @returns {string} - Formatted string for display
 */
export function formatVehicleDisplay(data) {
  if (!data) return 'Unknown Vehicle';
  
  const parts = [];
  if (data.year) parts.push(data.year);
  if (data.make) parts.push(data.make);
  if (data.model) parts.push(data.model);
  if (data.trim) parts.push(data.trim);
  
  return parts.join(' ') || 'Unknown Vehicle';
}

/**
 * Get additional vehicle details for display in confirmation modal
 * @param {object} data - The decoded vehicle data
 * @returns {Array<{label: string, value: string}>} - Array of detail objects
 */
export function getVehicleDetails(data) {
  if (!data) return [];
  
  const details = [];
  
  if (data.bodyClass) {
    details.push({ label: 'Body Type', value: data.bodyClass });
  }
  if (data.driveType) {
    details.push({ label: 'Drive Type', value: data.driveType });
  }
  if (data.engineCylinders) {
    details.push({ label: 'Engine', value: `${data.engineCylinders} Cylinder${data.engineSize ? ` ${data.engineSize}` : ''}` });
  } else if (data.engineSize) {
    details.push({ label: 'Engine', value: data.engineSize });
  }
  if (data.fuelType) {
    details.push({ label: 'Fuel Type', value: data.fuelType });
  }
  if (data.transmissionStyle) {
    details.push({ label: 'Transmission', value: data.transmissionStyle });
  }
  if (data.doors) {
    details.push({ label: 'Doors', value: data.doors });
  }
  
  return details;
}
