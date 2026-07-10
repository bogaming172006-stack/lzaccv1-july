/**
 * Formats a phone number to ensure it starts with the country code '91' (India).
 * Strips leading 0s, spaces, plus signs, dashes, parentheses, and prefixes with 91.
 */
export function formatContactWith91(phone: string | number | undefined | null): string {
  let clean = String(phone || '').trim();
  if (!clean) return '';
  
  // Remove spaces, dashes, parentheses, plus signs
  clean = clean.replace(/[\s\-\(\)\+]/g, '');
  
  // If it has leading 0 (like 09876543210), strip the leading 0
  if (clean.startsWith('0')) {
    clean = clean.substring(1);
  }
  
  // If it's exactly 10 digits, prepend '91'
  if (/^\d{10}$/.test(clean)) {
    return '91' + clean;
  }
  
  // If it's already starting with '91' followed by 10 digits (total 12 digits), return it as is
  if (/^91\d{10}$/.test(clean)) {
    return clean;
  }
  
  // Fallback: if it's numeric only and does not start with '91', prepend '91'
  if (/^\d+$/.test(clean) && !clean.startsWith('91')) {
    return '91' + clean;
  }
  
  return clean;
}
