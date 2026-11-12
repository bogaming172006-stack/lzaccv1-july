import { User } from '../types';

export const ADMIN_WHATSAPP_NUMBER = '7501273632';
export const ADMIN_WHATSAPP_INTERNATIONAL = '917501273632';

/**
 * Returns a stable unique identifier for the current browser/device.
 * Stored in localStorage as 'ledger_device_id'.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem('ledger_device_id');
    if (!id || id.trim() === '') {
      // Create a clean readable ID, e.g. DEV-A7F48C2B
      const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
      id = `DEV-${randomPart}`;
      localStorage.setItem('ledger_device_id', id);
    }
    return id;
  } catch {
    return 'DEV-DEFAULT';
  }
}

/**
 * Checks whether a given deviceId is authorized for the given user.
 * - If user has authorizedDeviceId matching deviceId, true.
 * - If user has authorizedDeviceIds array containing deviceId, true.
 * - If no device has ever been authorized for this user and this is the creating deviceId matching user.deviceId, true.
 */
export function isDeviceAuthorized(user: Partial<User> | null | undefined, deviceId: string): boolean {
  if (!user) return false;
  const currentDev = (deviceId || '').trim();
  if (!currentDev) return false;

  // Check array of authorized device IDs
  if (Array.isArray(user.authorizedDeviceIds) && user.authorizedDeviceIds.length > 0) {
    if (user.authorizedDeviceIds.some(id => (id || '').trim().toUpperCase() === currentDev.toUpperCase())) {
      return true;
    }
  }

  // Check primary authorizedDeviceId
  if (user.authorizedDeviceId && user.authorizedDeviceId.trim() !== '') {
    return user.authorizedDeviceId.trim().toUpperCase() === currentDev.toUpperCase();
  }

  // Fallback: If no device has been explicitly authorized yet for this account:
  const hasConfiguredDevices = 
    Boolean(user.authorizedDeviceId && user.authorizedDeviceId.trim() !== '') ||
    (Array.isArray(user.authorizedDeviceIds) && user.authorizedDeviceIds.length > 0);

  if (!hasConfiguredDevices) {
    // If Admin account has no configured devices yet, allow first login to bind this device
    if (user.isAdmin) {
      return true;
    }
    // Also if legacy user.deviceId matches
    if (user.deviceId && user.deviceId.trim().toUpperCase() === currentDev.toUpperCase()) {
      return true;
    }
  }

  return false;
}

/**
 * Builds the WhatsApp redirect URL to send Device ID to the admin.
 * Number: 7501273632 (+91 7501273632)
 */
export function getDeviceAuthWhatsAppUrl(usernameOrName: string, deviceId: string, user?: Partial<User>): string {
  const opName = user?.name || usernameOrName || 'Operator';
  const opUser = user?.username || usernameOrName || '';
  
  const text = 
    `*DEVICE AUTHORIZATION REQUEST*\n` +
    `Hello Admin, please authorize my device to access the Ledger.\n\n` +
    `👤 *Operator Name:* ${opName}${opUser && opUser !== opName ? ` (${opUser})` : ''}\n` +
    `📱 *Device ID is:* ${deviceId}\n\n` +
    `Please assign and authorize this Device ID to my user account so I can log in. Thank you!`;

  return `https://wa.me/${ADMIN_WHATSAPP_INTERNATIONAL}?text=${encodeURIComponent(text)}`;
}
