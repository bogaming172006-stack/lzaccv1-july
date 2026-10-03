/**
 * Centralized invoice and info entry classification utilities.
 *
 * Rules:
 * - Real Invoice: Contains numeric digits and represents a billing sequence
 *   (e.g., "101", "INV-101", "GST-042", "2024-25/001", "B-500").
 * - Info Entry:
 *   1. Empty, missing, "-", "none", "n/a", etc.
 *   2. Pure letters/words with NO digits (e.g., "CASH", "ADVANCE", "CHQ", "UPI", "PAYMENT", "EXPENSE", "INFO", "NOTE", "SAMPLE", "BILL", "MEMO").
 *   3. Non-invoice instrument references (e.g. "CHQ 1234", "UPI 4821", "TRN-00001", "ADV 5000", "CASH 200").
 */

// Common non-invoice prefixes that represent instruments, transfers, or remarks even if they contain numbers
const NON_INVOICE_PREFIX_REGEX = /^(trn|tr note|transfer|chq|cheque|dd|upi|g[- ]?pay|phone[- ]?pe|paytm|neft|rtgs|imps|adv(ance)?|cash|pay(ment)?|rec(eipt)?|rcpt|adj(ustment)?|jv|contra|note|info|remark|bank|loan|salary|exp(ense)?)[- :./\d]/i;

const NON_INVOICE_EXACT_KEYWORDS = new Set([
  '',
  '-',
  '--',
  '---',
  'none',
  'n/a',
  'na',
  'nil',
  'null',
  'no',
  'info',
  'note',
  'general',
  'ref',
  'other',
  'trn',
  'chq',
  'cheque',
  'cash',
  'upi',
  'adv',
  'advance',
  'payment',
  'receipt',
  'rec',
  'rcpt',
  'neft',
  'rtgs',
  'imps',
  'dd',
  'bank',
  'adj',
  'adjustment',
  'jv',
  'contra',
  'sample',
  'expense',
  'exp'
]);

/**
 * Checks if a raw invoice number string represents an actual invoice.
 * If the user entered any letter/word or something different than an invoice, returns false.
 */
export function isInvoiceNumber(raw?: string | null): boolean {
  if (!raw) return false;
  const clean = raw.toString().trim();
  if (!clean) return false;

  const lower = clean.toLowerCase();
  if (NON_INVOICE_EXACT_KEYWORDS.has(lower)) {
    return false;
  }

  // An invoice MUST contain at least one digit (e.g. 101, INV-1, B-42).
  // If the user typed only letters/words with no digits at all, it is an Info entry.
  const hasDigits = /\d/.test(clean);
  if (!hasDigits) {
    return false;
  }

  // Check if it starts with a non-invoice identifier (like TRN-0001, CHQ 12345, ADV 5000, CASH-100)
  if (NON_INVOICE_PREFIX_REGEX.test(clean)) {
    return false;
  }

  return true;
}

/**
 * Checks if a transaction is a genuine invoice transaction.
 */
export function isInvoiceTx(tx: { invoiceNo?: string | null; notes?: string | null }): boolean {
  if (!tx) return false;
  
  // If invoiceNo is not an invoice number, it's not an invoice
  if (!isInvoiceNumber(tx.invoiceNo)) {
    return false;
  }

  return true;
}

/**
 * Checks if a transaction is an info / non-invoice entry.
 */
export function isInfoTx(tx: { invoiceNo?: string | null; notes?: string | null }): boolean {
  return !isInvoiceTx(tx);
}

/**
 * Returns formatted descriptor for displaying invoice vs info in table & cards.
 */
export function getInvoiceDisplay(rawInvoiceNo?: string | null): {
  isInvoice: boolean;
  displayText: string;
  badgeLabel: string;
  hasCustomRef: boolean;
} {
  const isInvoice = isInvoiceNumber(rawInvoiceNo);
  const clean = (rawInvoiceNo || '').trim();
  const hasCustomRef = clean !== '' && clean !== '-' && clean.toLowerCase() !== 'none';

  if (isInvoice) {
    return {
      isInvoice: true,
      displayText: clean,
      badgeLabel: `Inv #${clean}`,
      hasCustomRef: true,
    };
  }

  return {
    isInvoice: false,
    displayText: hasCustomRef ? clean : '',
    badgeLabel: hasCustomRef ? clean : 'Info',
    hasCustomRef,
  };
}
