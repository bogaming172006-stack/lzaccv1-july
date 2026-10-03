/**
 * Bluetooth Thermal & POS Printer Driver (Web Bluetooth ESC/POS & RawBT)
 * Supports standard 58mm (32 cols), 72mm (42 cols), and 80mm (48 cols) Bluetooth thermal receipt printers.
 */

import { format } from 'date-fns';
import { formatAmountInWords } from './numberToWords';

export interface ReceiptItemData {
  name: string;
  qty: number;
  rate?: number;
  line_total?: number;
  mark?: string | null;
}

export interface ReceiptPrintData {
  title: string;
  companyName?: string;
  ledgerName?: string;
  invoiceNo: string;
  date: string;
  time: string;
  partyLabel: string;
  partyName: string;
  partyPhone?: string;
  partyAddress?: string;
  particulars?: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT';
  beforeBalance?: number;
  afterBalance?: number;
  amountInWords?: string;
  paperWidth?: '58mm' | '72mm' | '80mm';
  items?: ReceiptItemData[];
  vehicleNumber?: string;
  driverName?: string;
  salesmanName?: string;
}

export interface BluetoothPrinterStatus {
  state: 'idle' | 'connecting' | 'printing' | 'success' | 'error';
  deviceName?: string;
  message?: string;
}

// Common GATT Service UUIDs used by mobile Bluetooth thermal printers (POS-58, POS-80, MPT-II, etc.)
const KNOWN_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard ESC/POS Service
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Pos-58/80 Custom
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Generic BLE Serial (HM-10)
  '0000fff0-0000-1000-8000-00805f9b34fb', // Standard Chinese BLE printer
  '0000ff00-0000-1000-8000-00805f9b34fb', // Custom thermal
];

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// Keep connected device in module scope for seamless re-prints
let cachedDevice: any = null;
let cachedCharacteristic: any = null;

export function getCachedPrinterName(): string | null {
  return cachedDevice?.name || null;
}

export function disconnectBluetoothPrinter(): void {
  try {
    if (cachedDevice && cachedDevice.gatt && cachedDevice.gatt.connected) {
      cachedDevice.gatt.disconnect();
    }
  } catch (e) {
    console.error('Error disconnecting printer:', e);
  }
  cachedDevice = null;
  cachedCharacteristic = null;
}

/**
 * Format currency with Indian Rupee symbol (Rs. or ₹)
 */
function formatRupeesPlain(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `Rs. ${abs}`;
}

/**
 * Build ESC/POS bytes for thermal receipt printing
 */
export function buildEscPosReceipt(data: ReceiptPrintData): Uint8Array {
  const bytes: number[] = [];
  const widthChars = data.paperWidth === '58mm' ? 32 : data.paperWidth === '80mm' ? 48 : 42;
  const divider = '-'.repeat(widthChars);
  const doubleDivider = '='.repeat(widthChars);

  const enc = new TextEncoder();
  const pushText = (str: string) => {
    // Replace non-ASCII rupee symbol with "Rs." for 100% ESC/POS hardware safety
    const safeStr = str.replace(/₹/g, 'Rs. ');
    const encoded = enc.encode(safeStr);
    for (let i = 0; i < encoded.length; i++) {
      bytes.push(encoded[i]);
    }
  };

  const pushLine = (str: string = '') => {
    pushText(str);
    bytes.push(0x0a); // LF
  };

  // Helper for two-column aligned line
  const pushTwoCols = (left: string, right: string) => {
    const spaceCount = widthChars - (left.length + right.length);
    if (spaceCount <= 0) {
      pushLine(`${left} ${right}`);
    } else {
      pushLine(left + ' '.repeat(spaceCount) + right);
    }
  };

  // 1. Initialize Printer (ESC @)
  bytes.push(0x1b, 0x40);

  // 2. Select Character Code Table (PC437 Standard USA)
  bytes.push(0x1b, 0x74, 0x00);

  // 3. Header: Company Name (Center, Double Height)
  bytes.push(0x1b, 0x61, 0x01); // Center
  bytes.push(0x1b, 0x45, 0x01); // Bold ON
  bytes.push(0x1d, 0x21, 0x01); // Double height
  pushLine(data.companyName || 'GREENZAR FOOD & BEVERAGE');
  bytes.push(0x1d, 0x21, 0x00); // Normal size
  bytes.push(0x1b, 0x45, 0x00); // Bold OFF

  if (data.ledgerName) {
    pushLine(`Book: ${data.ledgerName}`);
  }
  bytes.push(0x0a);

  // 4. Voucher Title Box
  bytes.push(0x1b, 0x45, 0x01); // Bold ON
  pushLine(`*** ${data.title.toUpperCase()} ***`);
  bytes.push(0x1b, 0x45, 0x00); // Bold OFF
  pushLine(doubleDivider);

  // 5. Meta info (Left aligned)
  bytes.push(0x1b, 0x61, 0x00); // Left align
  pushTwoCols(`REF NO: #${data.invoiceNo}`, `DATE: ${data.date}`);
  pushTwoCols(`TIME: ${data.time}`, `TYPE: ${data.type}`);
  pushLine(divider);

  // 6. Party Information
  bytes.push(0x1b, 0x45, 0x01); // Bold ON
  pushLine(`${data.partyLabel.toUpperCase()}:`);
  pushLine(data.partyName.toUpperCase());
  bytes.push(0x1b, 0x45, 0x00); // Bold OFF
  if (data.partyPhone) {
    pushLine(`Phone: ${data.partyPhone}`);
  }
  if (data.partyAddress) {
    pushLine(`Addr: ${data.partyAddress}`);
  }
  pushLine(divider);

  // 6b. Ordered Items Breakdown (if present)
  if (data.items && data.items.length > 0) {
    bytes.push(0x1b, 0x45, 0x01); // Bold ON
    if (widthChars >= 40) {
      pushTwoCols('ITEM (QTY x RATE)', 'AMOUNT');
    } else {
      pushTwoCols('ITEM [QTY]', 'TOTAL');
    }
    bytes.push(0x1b, 0x45, 0x00); // Bold OFF
    pushLine(divider);

    let totalItemsQty = 0;
    data.items.forEach((item, idx) => {
      const q = Number(item.qty) || 0;
      totalItemsQty += q;
      const rate = Number(item.rate) || 0;
      const total = Number(item.line_total) || (q * rate);
      const totalStr = formatRupeesPlain(total);

      const itemName = `${idx + 1}. ${item.name}${item.mark ? ` (${item.mark})` : ''}`;
      if (widthChars >= 40 && rate > 0) {
        const left = `${itemName} (${q}x${formatRupeesPlain(rate)})`;
        pushTwoCols(left, totalStr);
      } else {
        const left = `${itemName} [${q}]`;
        pushTwoCols(left, totalStr);
      }
    });

    pushLine(divider);
    bytes.push(0x1b, 0x45, 0x01); // Bold ON
    pushTwoCols(`TOTAL ITEMS: ${totalItemsQty} pcs`, `ITEMS: ${formatRupeesPlain(data.amount)}`);
    bytes.push(0x1b, 0x45, 0x00); // Bold OFF
    pushLine(divider);
  }

  // 6c. Transport & Vehicle Details
  if (data.vehicleNumber || data.driverName || data.salesmanName) {
    if (data.vehicleNumber) pushTwoCols('VEHICLE NO:', data.vehicleNumber.toUpperCase());
    if (data.driverName) pushTwoCols('DRIVER:', data.driverName.toUpperCase());
    if (data.salesmanName) pushTwoCols('SALESMAN:', data.salesmanName.toUpperCase());
    pushLine(divider);
  }

  // 7. Amount Box (Prominent Bold Center)
  bytes.push(0x1b, 0x61, 0x01); // Center
  pushLine(`VOUCHER AMOUNT (${data.type === 'DEBIT' ? 'DR' : 'CR'})`);
  bytes.push(0x1b, 0x45, 0x01); // Bold ON
  bytes.push(0x1d, 0x21, 0x11); // Double width & height
  pushLine(formatRupeesPlain(data.amount));
  bytes.push(0x1d, 0x21, 0x00); // Normal size
  bytes.push(0x1b, 0x45, 0x00); // Bold OFF
  bytes.push(0x0a);

  // 8. Amount in Words
  if (data.amountInWords) {
    bytes.push(0x1b, 0x61, 0x00); // Left align
    pushLine(`In Words: INR ${data.amountInWords.toUpperCase()}`);
    pushLine(divider);
  }

  // 9. Accounting Reconciliation Balance Table
  bytes.push(0x1b, 0x61, 0x00); // Left
  if (data.beforeBalance !== undefined) {
    const bfSign = data.beforeBalance > 0 ? 'Dr' : data.beforeBalance < 0 ? 'Cr' : '';
    pushTwoCols('Previous Balance:', `${formatRupeesPlain(Math.abs(data.beforeBalance))} ${bfSign}`);
  }

  pushTwoCols(
    `This Entry (${data.type === 'DEBIT' ? 'Dr' : 'Cr'}):`,
    formatRupeesPlain(data.amount)
  );

  if (data.afterBalance !== undefined) {
    pushLine(divider);
    bytes.push(0x1b, 0x45, 0x01); // Bold ON
    const afSign = data.afterBalance > 0 ? 'Dr' : data.afterBalance < 0 ? 'Cr' : '';
    pushTwoCols('NET CURRENT BALANCE:', `${formatRupeesPlain(Math.abs(data.afterBalance))} ${afSign}`);
    bytes.push(0x1b, 0x45, 0x00); // Bold OFF
  }
  pushLine(doubleDivider);

  // 10. Remarks / Particulars
  if (data.particulars && data.particulars.trim()) {
    pushLine('REMARKS / PARTICULARS:');
    pushLine(data.particulars);
    pushLine(divider);
  }

  // 11. Dual Signatures
  bytes.push(0x0a);
  bytes.push(0x0a);
  pushTwoCols("Receiver's Sign", "Authorized Sign");
  bytes.push(0x0a);

  // 12. Audit Footer
  bytes.push(0x1b, 0x61, 0x01); // Center
  pushLine('* Computer Generated Accounting Voucher *');
  pushLine('Thank you for your business!');
  bytes.push(0x0a);
  bytes.push(0x0a);
  bytes.push(0x0a);

  // 13. Feed & Paper Cut (GS V 66 0)
  bytes.push(0x1d, 0x56, 0x42, 0x00);

  return new Uint8Array(bytes);
}

/**
 * Print directly to a Bluetooth Thermal Printer using Web Bluetooth
 */
export async function printToBluetoothPrinter(
  data: ReceiptPrintData,
  onStatusChange?: (status: BluetoothPrinterStatus) => void
): Promise<{ success: boolean; error?: string; deviceName?: string }> {
  if (!isWebBluetoothSupported()) {
    const errMsg = 'Web Bluetooth is not supported on this browser. Try Chrome on Android, Windows, or Mac.';
    onStatusChange?.({ state: 'error', message: errMsg });
    return { success: false, error: errMsg };
  }

  try {
    onStatusChange?.({ state: 'connecting', message: 'Scanning for Bluetooth thermal printers...' });

    let device = cachedDevice;
    let characteristic = cachedCharacteristic;

    // Check if previous connection is still active
    if (!device || !device.gatt || !device.gatt.connected || !characteristic) {
      // Request Bluetooth device pairing
      device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_PRINTER_SERVICES
      });

      if (!device) {
        throw new Error('No Bluetooth printer selected.');
      }

      onStatusChange?.({
        state: 'connecting',
        deviceName: device.name || 'Thermal Printer',
        message: `Connecting to ${device.name || 'Bluetooth Printer'}...`
      });

      const server = await device.gatt.connect();

      // Find suitable writable characteristic
      characteristic = null;

      // Try known services first
      for (const serviceUuid of KNOWN_PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              characteristic = char;
              break;
            }
          }
          if (characteristic) break;
        } catch {
          // Continue to next candidate service
        }
      }

      // If not found in known services, search all primary services
      if (!characteristic) {
        try {
          const services = await server.getPrimaryServices();
          for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                characteristic = char;
                break;
              }
            }
            if (characteristic) break;
          }
        } catch (e) {
          console.warn('Could not enumerate all services:', e);
        }
      }

      if (!characteristic) {
        throw new Error(
          `Connected to ${device.name || 'device'}, but found no writable printer service. Please ensure this is an ESC/POS Bluetooth printer.`
        );
      }

      cachedDevice = device;
      cachedCharacteristic = characteristic;

      device.addEventListener('gattserverdisconnected', () => {
        cachedDevice = null;
        cachedCharacteristic = null;
      });
    }

    onStatusChange?.({
      state: 'printing',
      deviceName: device.name || 'Thermal Printer',
      message: `Sending receipt to ${device.name || 'Bluetooth Printer'}...`
    });

    // Generate ESC/POS byte sequence
    const escposBytes = buildEscPosReceipt(data);

    // Send bytes in safe chunks (64 bytes per chunk to avoid printer buffer overflow)
    const chunkSize = 64;
    for (let i = 0; i < escposBytes.length; i += chunkSize) {
      const chunk = escposBytes.slice(i, i + chunkSize);
      if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      // Small pause between chunks
      await new Promise(r => setTimeout(r, 25));
    }

    onStatusChange?.({
      state: 'success',
      deviceName: device.name || 'Thermal Printer',
      message: `Printed successfully on ${device.name || 'Bluetooth Printer'}!`
    });

    return {
      success: true,
      deviceName: device.name || 'Bluetooth Printer'
    };
  } catch (err: any) {
    console.error('Bluetooth thermal print error:', err);
    const errorMsg = err?.message || 'Bluetooth connection failed or cancelled.';
    onStatusChange?.({ state: 'error', message: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Open mobile RawBT Bluetooth print service intent (Android app fallback)
 */
export function openRawBtBluetoothPrint(data: ReceiptPrintData): boolean {
  try {
    const escposBytes = buildEscPosReceipt(data);
    let binary = '';
    for (let i = 0; i < escposBytes.length; i++) {
      binary += String.fromCharCode(escposBytes[i]);
    }
    const b64Data = btoa(binary);
    window.location.href = `rawbt:data:base64,${b64Data}`;
    return true;
  } catch (e) {
    console.error('RawBT print error:', e);
    return false;
  }
}

/**
 * Helper to build ReceiptPrintData for a stock/order bill with items
 */
export function createBillReceiptData(
  bill: {
    bill_no?: string;
    customer_name?: string;
    phone_number?: string;
    customer_address?: string;
    total_amount: number | string;
    total_qty?: number;
    vehicle_number?: string;
    driver_name?: string;
    salesman_name?: string;
    remark?: string;
    bill_date?: string;
    created_at?: string;
  },
  items: ReceiptItemData[] = [],
  companyName: string = 'GREENZAR FOOD & BEVERAGE',
  paperWidth: '58mm' | '72mm' | '80mm' = '58mm'
): ReceiptPrintData {
  const amount = Number(bill.total_amount) || 0;
  const now = new Date();
  return {
    title: 'ORDER DELIVERY BILL',
    companyName,
    invoiceNo: bill.bill_no ? String(bill.bill_no) : '0000',
    date: bill.bill_date || format(now, 'dd MMM yyyy'),
    time: format(now, 'hh:mm a'),
    partyLabel: 'CUSTOMER / PARTY',
    partyName: bill.customer_name || 'Anonymous Customer',
    partyPhone: bill.phone_number,
    partyAddress: bill.customer_address,
    particulars: bill.remark,
    amount,
    type: 'DEBIT',
    amountInWords: formatAmountInWords(amount),
    paperWidth,
    items,
    vehicleNumber: bill.vehicle_number,
    driverName: bill.driver_name,
    salesmanName: bill.salesman_name
  };
}
