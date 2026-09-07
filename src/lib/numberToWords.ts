import { ToWords } from 'to-words';

// Indian numbering units for pure TS fallback
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertLessThanThousand(num: number): string {
  let str = '';
  if (num >= 100) {
    str += ONES[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    str += TENS[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ONES[num % 10] : '');
  } else if (num > 0) {
    str += ONES[num];
  }
  return str.trim();
}

/**
 * Fallback converter for Indian currency numbering format:
 * Crores, Lakhs, Thousands, Hundreds
 */
function fallbackIndianNumberToWords(num: number): string {
  if (num === 0) return 'Zero Rupees Only';
  
  const absNum = Math.abs(num);
  const rupees = Math.floor(absNum);
  const paise = Math.round((absNum - rupees) * 100);

  let crore = Math.floor(rupees / 10000000);
  let remainder = rupees % 10000000;
  let lakh = Math.floor(remainder / 100000);
  remainder = remainder % 100000;
  let thousand = Math.floor(remainder / 1000);
  let hundred = remainder % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(convertLessThanThousand(crore) + ' Crore');
  if (lakh > 0) parts.push(convertLessThanThousand(lakh) + ' Lakh');
  if (thousand > 0) parts.push(convertLessThanThousand(thousand) + ' Thousand');
  if (hundred > 0) parts.push(convertLessThanThousand(hundred));

  let words = parts.join(' ').trim() || 'Zero';
  words += ' Rupees';

  if (paise > 0) {
    words += ' And ' + convertLessThanThousand(paise) + ' Paise';
  }

  words += ' Only';
  return words;
}

// Instantiate ToWords for Indian English currency
let toWordsInstance: ToWords | null = null;
try {
  toWordsInstance = new ToWords({
    localeCode: 'en-IN',
    converterOptions: {
      currency: true,
      ignoreDecimal: false,
      ignoreZeroCurrency: false,
      doNotAddOnly: false,
    }
  });
} catch (err) {
  console.warn('Could not initialize ToWords instance, using fallback:', err);
}

/**
 * Converts a numerical amount (or string) into Indian Rupees words.
 * Example: 15450.50 -> "Fifteen Thousand Four Hundred Fifty Rupees And Fifty Paise Only"
 */
export function formatAmountInWords(amount: number | string | undefined | null): string {
  if (amount === undefined || amount === null || amount === '') {
    return '';
  }

  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) {
    return '';
  }

  const rounded = Math.abs(Math.round(num * 100) / 100);

  if (toWordsInstance) {
    try {
      const converted = toWordsInstance.convert(rounded);
      if (converted && converted.trim()) {
        return converted.trim();
      }
    } catch (e) {
      console.warn('ToWords conversion failed, falling back to local converter:', e);
    }
  }

  return fallbackIndianNumberToWords(rounded);
}

/**
 * Shorthand alias
 */
export const toWordsInRupees = formatAmountInWords;
