export interface AvatarColor {
  bg: string;
  text: string;
  className: string;
}

const AVATAR_COLOR_MAP: Record<string, AvatarColor> = {
  A: { bg: '#FBA027', text: '#FFFFFF', className: 'avatar-a' },
  B: { bg: '#A2E8D0', text: '#065F46', className: 'avatar-b' },
  C: { bg: '#2563EB', text: '#FFFFFF', className: 'avatar-o' },
  D: { bg: '#8B5CF6', text: '#FFFFFF', className: 'avatar-g' },
  E: { bg: '#00B594', text: '#FFFFFF', className: 'avatar-t' },
  F: { bg: '#FF6685', text: '#FFFFFF', className: 'avatar-n' },
  G: { bg: '#8B5CF6', text: '#FFFFFF', className: 'avatar-g' },
  H: { bg: '#F95A2C', text: '#FFFFFF', className: 'avatar-s' },
  I: { bg: '#2563EB', text: '#FFFFFF', className: 'avatar-o' },
  J: { bg: '#A2E8D0', text: '#065F46', className: 'avatar-b' },
  K: { bg: '#FBA027', text: '#FFFFFF', className: 'avatar-a' },
  L: { bg: '#C084FC', text: '#FFFFFF', className: 'avatar-r' },
  M: { bg: '#FF6685', text: '#FFFFFF', className: 'avatar-n' },
  N: { bg: '#FF6685', text: '#FFFFFF', className: 'avatar-n' },
  O: { bg: '#2563EB', text: '#FFFFFF', className: 'avatar-o' },
  P: { bg: '#00B594', text: '#FFFFFF', className: 'avatar-t' },
  Q: { bg: '#FBA027', text: '#FFFFFF', className: 'avatar-a' },
  R: { bg: '#C084FC', text: '#FFFFFF', className: 'avatar-r' },
  S: { bg: '#F95A2C', text: '#FFFFFF', className: 'avatar-s' },
  T: { bg: '#00B594', text: '#FFFFFF', className: 'avatar-t' },
  U: { bg: '#2563EB', text: '#FFFFFF', className: 'avatar-o' },
  V: { bg: '#8B5CF6', text: '#FFFFFF', className: 'avatar-g' },
  W: { bg: '#00B594', text: '#FFFFFF', className: 'avatar-t' },
  X: { bg: '#F95A2C', text: '#FFFFFF', className: 'avatar-s' },
  Y: { bg: '#FBA027', text: '#FFFFFF', className: 'avatar-a' },
  Z: { bg: '#C084FC', text: '#FFFFFF', className: 'avatar-r' },
};

export function getAvatarColor(name: string): AvatarColor {
  if (!name || !name.trim()) {
    return { bg: '#1A73E8', text: '#FFFFFF', className: 'avatar-o' };
  }
  const firstLetter = name.trim().charAt(0).toUpperCase();
  return AVATAR_COLOR_MAP[firstLetter] || { bg: '#2563EB', text: '#FFFFFF', className: 'avatar-o' };
}

export function formatCustomerCurrency(amount: number, currency: string = '₹'): string {
  const absVal = Math.abs(amount || 0);
  if (!currency || currency === '₹' || currency === 'INR' || currency === 'Rs' || currency === 'Rs.') {
    return `₹${absVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (currency === 'Rp') {
    return `Rp ${absVal.toLocaleString('id-ID')}`;
  }
  if (currency === '$') {
    return `$ ${absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${absVal.toLocaleString()}`;
}

export const DEMO_CUSTOMERS_DATA = [
  {
    name: "Acme Corp",
    email: "contact@acme.com",
    phone: "+62 812 3456 7890",
    address: "Sudirman Central Business District, Jakarta",
    transactions: [
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-001", amount: 2500000, daysAgo: 0, hoursAgo: 2 },
      { type: "CREDIT" as const, notes: "Bank Transfer", amount: 4000000, daysAgo: 1, hoursAgo: 5 },
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-002", amount: 5000000, daysAgo: 5, hoursAgo: 8 },
      { type: "CREDIT" as const, notes: "Cash Payment", amount: 4250000, daysAgo: 18, hoursAgo: 4 },
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-003", amount: 5000000, daysAgo: 31, hoursAgo: 6 }
    ]
  },
  {
    name: "Bright Studio",
    email: "info@brightstudio.com",
    phone: "+62 813 2222 1111",
    address: "Jl. Sunset Road No. 88, Bali",
    transactions: [
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-015", amount: 3200000, daysAgo: 2, hoursAgo: 3 },
      { type: "CREDIT" as const, notes: "Direct Deposit", amount: 2500000, daysAgo: 9, hoursAgo: 7 },
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-009", amount: 2500000, daysAgo: 23, hoursAgo: 5 }
    ]
  },
  {
    name: "Global Media",
    email: "hello@globalmedia.com",
    phone: "+62 811 3333 4444",
    address: "Kuningan Tower Lt. 14, Jakarta Selatan",
    transactions: [
      { type: "CREDIT" as const, notes: "Advance Payment", amount: 6000000, daysAgo: 1, hoursAgo: 6 },
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-018", amount: 4500000, daysAgo: 8, hoursAgo: 4 }
    ]
  },
  {
    name: "Tech Solutions",
    email: "sales@techsolutions.com",
    phone: "+62 812 5555 6666",
    address: "Cyber 2 Tower, Jakarta",
    transactions: [
      { type: "DEBIT" as const, notes: "Cloud Hosting Q4", amount: 1850000, daysAgo: 0, hoursAgo: 7 },
      { type: "CREDIT" as const, notes: "QuickPay Payment", amount: 1850000, daysAgo: 21, hoursAgo: 9 }
    ]
  },
  {
    name: "Sunrise LLC",
    email: "info@sunrise.co",
    phone: "+62 813 7777 8888",
    address: "Dago Asri No. 12, Bandung",
    transactions: [
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-022", amount: 7400000, daysAgo: 1, hoursAgo: 8 }
    ]
  },
  {
    name: "Ocean Trading",
    email: "contact@oceantrading.com",
    phone: "+62 814 9999 0000",
    address: "Tanjung Perak Port Area, Surabaya",
    transactions: [
      { type: "CREDIT" as const, notes: "Wire Payment", amount: 5000000, daysAgo: 3, hoursAgo: 4 },
      { type: "DEBIT" as const, notes: "Shipping Freight Fee", amount: 7100000, daysAgo: 18, hoursAgo: 2 }
    ]
  },
  {
    name: "Nova Industries",
    email: "sales@novaind.com",
    phone: "+62 821 1234 5678",
    address: "Kawasan Industri MM2100, Cikarang",
    transactions: [
      { type: "DEBIT" as const, notes: "Invoice #INV-2026-031", amount: 3500000, daysAgo: 1, hoursAgo: 1 }
    ]
  },
  {
    name: "Rapid Systems",
    email: "support@rapidsys.com",
    phone: "+62 822 8765 4321",
    address: "Plaza Sentral, Jakarta",
    transactions: [
      { type: "CREDIT" as const, notes: "Settlement Payment", amount: 1200000, daysAgo: 2, hoursAgo: 10 },
      { type: "DEBIT" as const, notes: "Security Audit Report", amount: 1200000, daysAgo: 13, hoursAgo: 4 }
    ]
  }
];
