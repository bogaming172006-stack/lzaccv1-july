import React, { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import { X, Printer, Download, Receipt, Lock, Eye, EyeOff, Key, SlidersHorizontal, Check, Bluetooth, Loader2, AlertCircle } from 'lucide-react';
import { Transaction, Ledger } from '../types';
import CompanyLogo, { loadImage, getOptimizedLogoData } from './CompanyLogo';
import { exportEncryptedPdf, downloadPdfBlob } from '../lib/pdfEncrypt';
import { formatAmountInWords } from '../lib/numberToWords';
import {
  printToBluetoothPrinter,
  isWebBluetoothSupported,
  openRawBtBluetoothPrint,
  getCachedPrinterName,
  ReceiptPrintData,
  BluetoothPrinterStatus
} from '../lib/bluetoothPrinter';

interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  partyName: string;
  partyPhone?: string;
  partyAddress?: string;
  ledgerName: string;
  ledgerType?: Ledger['type'];
  isPurchaseStyle?: boolean;
  autoPrint?: boolean;
  customTitle?: string;
  items?: { product_name: string; qty: number; rate?: number; line_total?: number; mark_text?: string | null }[];
  vehicleNumber?: string;
  driverName?: string;
  salesmanName?: string;
}

export function getReceiptTitle(ledgerType?: Ledger['type'], txType?: 'DEBIT' | 'CREDIT') {
  if (ledgerType === 'EXPENSE') {
    return txType === 'DEBIT' ? 'EXPENSE PAYMENT VOUCHER' : 'EXPENSE REFUND RECEIPT';
  }
  if (ledgerType === 'CASH_BANK') {
    return txType === 'DEBIT' ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER';
  }
  if (ledgerType === 'PURCHASE') {
    return txType === 'DEBIT' ? 'PAYMENT VOUCHER' : 'PURCHASE INVOICE RECEIPT';
  }
  if (ledgerType === 'SALE') {
    return txType === 'CREDIT' ? 'PAYMENT RECEIPT' : 'SALES INVOICE RECEIPT';
  }
  return txType === 'CREDIT' ? 'PAYMENT RECEIPT' : 'TRANSACTION VOUCHER';
}

export function getPartyLabel(ledgerType?: Ledger['type'], txType?: 'DEBIT' | 'CREDIT') {
  if (ledgerType === 'EXPENSE') {
    return txType === 'DEBIT' ? 'PAID TO' : 'RECEIVED FROM';
  }
  if (ledgerType === 'PURCHASE') {
    return txType === 'DEBIT' ? 'PAID TO (VENDOR)' : 'SUPPLIER / VENDOR';
  }
  if (ledgerType === 'CASH_BANK') {
    return txType === 'DEBIT' ? 'PAID TO' : 'RECEIVED FROM';
  }
  if (ledgerType === 'SALE') {
    return txType === 'CREDIT' ? 'RECEIVED FROM' : 'BILL TO / CUSTOMER';
  }
  return txType === 'DEBIT' ? 'PAID TO' : 'RECEIVED FROM';
}

// Clean SVG Barcode pattern generator for crisp professional thermal receipts
function ReceiptBarcode({ value, isNarrow = false }: { value: string; isNarrow?: boolean }) {
  const pattern = [2, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 2, 1, 3, 1, 2, 1, 3, 2];
  return (
    <div className="flex flex-col items-center justify-center my-1">
      <svg className={isNarrow ? "w-36 h-6" : "w-44 h-7"} viewBox="0 0 160 26" preserveAspectRatio="none">
        {pattern.map((w, i) => {
          const currentX = (i * 5.2) + 8;
          return (
            <rect key={i} x={currentX} y={0} width={w} height={22} fill="#000000" />
          );
        })}
      </svg>
      <span className="text-[8.5px] font-mono tracking-widest uppercase text-black font-bold mt-0.5">
        {value}
      </span>
    </div>
  );
}

export default function ThermalReceiptModal({
  isOpen,
  onClose,
  transaction,
  partyName,
  partyPhone,
  partyAddress,
  ledgerName,
  ledgerType,
  isPurchaseStyle = false,
  autoPrint = false,
  customTitle,
  items,
  vehicleNumber,
  driverName,
  salesmanName
}: ThermalReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [paperSize, setPaperSize] = useState<'72mm' | '80mm' | '58mm'>('72mm');
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPassInput, setShowPassInput] = useState(false);
  const [showPassText, setShowPassText] = useState(false);

  const [bluetoothStatus, setBluetoothStatus] = useState<BluetoothPrinterStatus>({ state: 'idle' });
  const hasWebBluetooth = isWebBluetoothSupported();
  const cachedBtName = getCachedPrinterName();

  const receiptTitle = customTitle || getReceiptTitle(ledgerType, transaction.type);
  const partyLabel = getPartyLabel(ledgerType, transaction.type);

  const afterOutstanding = transaction.runningBalance ?? 0;
  const balanceChange = transaction.type === 'DEBIT' ? transaction.amount : -transaction.amount;
  const beforeOutstanding = afterOutstanding - balanceChange;

  const formatBalancePlain = (amount: number) => {
    if (amount === 0) return '₹0.00';
    const absVal = Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount > 0 ? `₹${absVal} Dr` : `₹${absVal} Cr`;
  };

  const formattedInvoiceNo = (transaction.invoiceNo || transaction.id.substring(0, 8)).toUpperCase();
  const txDate = new Date(transaction.timestamp);
  const formattedDate = format(txDate, 'dd MMM yyyy');
  const formattedTime = format(txDate, 'hh:mm a');

  const getReceiptData = (): ReceiptPrintData => ({
    title: receiptTitle,
    companyName: 'GREENZAR FOOD & BEVERAGE',
    ledgerName,
    invoiceNo: formattedInvoiceNo,
    date: formattedDate,
    time: formattedTime,
    partyLabel,
    partyName,
    partyPhone,
    partyAddress,
    particulars: transaction.notes,
    amount: transaction.amount,
    type: transaction.type,
    beforeBalance: beforeOutstanding,
    afterBalance: afterOutstanding,
    amountInWords: formatAmountInWords(transaction.amount),
    paperWidth: paperSize,
    items: items?.map(it => ({
      name: it.product_name,
      qty: it.qty,
      rate: it.rate,
      line_total: it.line_total,
      mark: it.mark_text
    })),
    vehicleNumber,
    driverName,
    salesmanName
  });

  const handleBluetoothPrint = async () => {
    const data = getReceiptData();
    setBluetoothStatus({ state: 'connecting', message: 'Scanning Bluetooth thermal printers...' });

    const result = await printToBluetoothPrinter(data, (st) => {
      setBluetoothStatus(st);
    });

    if (result.success) {
      setTimeout(() => {
        setBluetoothStatus({ state: 'idle' });
      }, 4000);
    }
  };

  const handleRawBtPrint = () => {
    const data = getReceiptData();
    openRawBtBluetoothPrint(data);
  };

  const handlePrint = () => {
    const printContent = document.getElementById('thermal-receipt-print-content');
    if (!printContent) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!iframeDoc) return;

    const printWidth = paperSize === '58mm' ? '58mm' : paperSize === '80mm' ? '80mm' : '72mm';
    const bodyPadding = paperSize === '58mm' 
      ? '1.5mm 2mm 3mm 2mm' 
      : paperSize === '80mm' 
      ? '2.5mm 3.5mm 4mm 3.5mm' 
      : '2mm 2.5mm 3.5mm 2.5mm';

    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${receiptTitle} - ${formattedInvoiceNo}</title>
          <style>
            @page {
              size: ${printWidth} auto;
              margin: 0;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, monospace;
              font-size: ${paperSize === '58mm' ? '9.5px' : paperSize === '72mm' ? '10px' : '11px'};
              line-height: 1.3;
              color: #000000;
              background: #ffffff;
              width: ${printWidth};
              padding: ${bodyPadding};
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              image-rendering: -webkit-optimize-contrast;
            }
            .text-center { text-align: center !important; }
            .text-right { text-align: right !important; }
            .text-left { text-align: left !important; }
            .font-bold { font-weight: 700 !important; }
            .font-extrabold { font-weight: 800 !important; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important; }
            .uppercase { text-transform: uppercase !important; }
            .flex { display: flex !important; }
            .flex-col { flex-direction: column !important; }
            .justify-between { justify-content: space-between !important; }
            .justify-center { justify-content: center !important; }
            .items-center { align-items: center !important; }
            .items-end { align-items: flex-end !important; }
            .flex-1 { flex: 1 1 0% !important; }
            .w-full { width: 100% !important; }
            .tabular-nums { font-variant-numeric: tabular-nums !important; }
            
            .logo-container {
              display: flex !important;
              justify-content: center !important;
              align-items: center !important;
              width: 100% !important;
              margin: 2px auto 8px auto !important;
              padding-bottom: 2px !important;
              text-align: center !important;
            }
            .logo-container img {
              height: ${paperSize === '58mm' ? '32px' : paperSize === '72mm' ? '36px' : '40px'};
              max-height: 44px;
              width: auto;
              margin: 0 auto !important;
              display: block !important;
              object-fit: contain;
            }

            .header-org {
              font-size: ${paperSize === '58mm' ? '11px' : paperSize === '72mm' ? '12px' : '13px'};
              font-weight: 800;
              letter-spacing: 0.5px;
              text-transform: uppercase;
              text-align: center;
              margin-top: 3px;
              margin-bottom: 2px;
              line-height: 1.3;
            }
            .header-sub {
              font-size: ${paperSize === '58mm' ? '7.5px' : paperSize === '72mm' ? '8px' : '8.5px'};
              color: #222222;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              text-align: center;
              margin-bottom: 3px;
            }
            .voucher-badge {
              display: inline-block;
              background-color: #000000 !important;
              color: #ffffff !important;
              font-size: ${paperSize === '58mm' ? '9px' : paperSize === '72mm' ? '9.8px' : '10.5px'};
              font-weight: 800;
              padding: 2.5px 8px;
              margin: 2px auto;
              border-radius: 3px;
              letter-spacing: 0.5px;
              text-align: center;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .rule-solid {
              border-top: 1.5px solid #000000;
              margin: 4px 0;
            }
            .rule-double {
              border-top: 1px solid #000000;
              border-bottom: 1px solid #000000;
              height: 3px;
              margin: 4px 0;
            }
            .rule-dashed {
              border-top: 1px dashed #000000;
              margin: 4px 0;
            }

            .meta-grid {
              display: grid !important;
              grid-template-columns: 1fr 1fr !important;
              column-gap: 8px !important;
              row-gap: 3px !important;
              margin: 4px 0 !important;
              width: 100% !important;
              font-size: ${paperSize === '58mm' ? '8.5px' : paperSize === '72mm' ? '9px' : '9.5px'};
            }
            .meta-item {
              display: flex !important;
              flex-direction: column !important;
            }
            .meta-label {
              font-size: ${paperSize === '58mm' ? '7.5px' : paperSize === '72mm' ? '7.8px' : '8px'};
              color: #555555;
              text-transform: uppercase;
              font-weight: 600;
              margin-bottom: 1px;
            }
            .meta-val {
              font-weight: 700;
              color: #000000;
              word-break: break-all;
            }

            .party-box {
              border: 1px solid #000000;
              border-radius: 3px;
              padding: 4px 6px;
              margin: 5px 0;
              background-color: #fafafa !important;
              width: 100%;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .party-tag {
              font-size: 7.5px;
              font-weight: 700;
              text-transform: uppercase;
              color: #555555;
              margin-bottom: 2px;
            }
            .party-name {
              font-size: ${paperSize === '58mm' ? '10.5px' : paperSize === '72mm' ? '11px' : '12px'};
              font-weight: 800;
              color: #000000;
              line-height: 1.2;
              word-break: break-word;
            }

            .recon-section {
              margin: 5px 0;
              width: 100%;
            }
            .recon-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: ${paperSize === '58mm' ? '8px' : paperSize === '72mm' ? '8.2px' : '8.5px'};
              font-weight: bold;
              text-transform: uppercase;
              color: #555555;
              border-bottom: 1px solid #000000;
              padding-bottom: 2px;
              margin-bottom: 3px;
            }
            .recon-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 2px 0;
              font-size: ${paperSize === '58mm' ? '9px' : paperSize === '72mm' ? '9.5px' : '10px'};
            }
            .net-closing-box {
              display: flex !important;
              justify-content: space-between !important;
              align-items: center !important;
              background-color: #000000 !important;
              color: #ffffff !important;
              padding: 4px 6px !important;
              margin: 4px 0 !important;
              border-radius: 3px !important;
              font-weight: bold !important;
              font-size: ${paperSize === '58mm' ? '10px' : paperSize === '72mm' ? '10.5px' : '11px'} !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .net-closing-box * {
              color: #ffffff !important;
            }

            .words-box {
              border: 1px solid #888888;
              border-radius: 2px;
              padding: 3px 5px;
              margin: 4px 0;
              font-size: ${paperSize === '58mm' ? '8px' : paperSize === '72mm' ? '8.5px' : '9px'};
              font-style: italic;
              line-height: 1.25;
              background-color: #fafafa !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .notes-box {
              margin: 4px 0;
              font-size: ${paperSize === '58mm' ? '8px' : paperSize === '72mm' ? '8.5px' : '9px'};
              padding: 3px 5px;
              background-color: #fdfdfd !important;
              border-left: 2.5px solid #000000;
              word-break: break-word;
            }

            .signatures-grid {
              display: flex !important;
              justify-content: space-between !important;
              align-items: flex-end !important;
              width: 100% !important;
              margin-top: 16px !important;
              margin-bottom: 6px !important;
              text-align: center !important;
              font-size: ${paperSize === '58mm' ? '7.5px' : paperSize === '72mm' ? '8px' : '8.5px'} !important;
            }
            .sig-col {
              flex: 1 !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: flex-end !important;
            }
            .sig-line {
              width: 80% !important;
              border-top: 1px dotted #000000 !important;
              margin: 0 auto 3px auto !important;
            }

            .footer-audit {
              text-align: center !important;
              margin-top: 6px !important;
              font-size: ${paperSize === '58mm' ? '7px' : paperSize === '72mm' ? '7.2px' : '7.5px'} !important;
              color: #444444 !important;
              line-height: 1.35 !important;
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    iframeDoc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Iframe printing failed, using fallback:", err);
        window.print();
      }

      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch (e) {}
      }, 800);
    }, 280);
  };

  useEffect(() => {
    if (isOpen && autoPrint) {
      const timer = setTimeout(() => {
        handlePrint();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoPrint]);

  if (!isOpen) return null;

  const handleDownloadPDF = async () => {
    // Professional 72mm/80mm PDF voucher layout with vector precision & mathematical symmetry
    const docWidth = paperSize === '58mm' ? 58 : paperSize === '80mm' ? 80 : 72;
    const docHeight = 175;
    const margin = paperSize === '58mm' ? 4 : paperSize === '72mm' ? 4.5 : 6;
    const leftX = margin;
    const rightX = docWidth - margin; // for 72mm: 67.5mm
    const contentWidth = rightX - leftX; // for 72mm: 63mm
    const centerX = docWidth / 2; // for 72mm: 36mm
    const innerPad = 2.2;

    const doc = new jsPDF({
      unit: 'mm',
      format: [docWidth, docHeight],
      orientation: 'portrait',
      compress: true
    });

    // Helper for safe ASCII currency formatting (never uses raw Unicode ₹ which breaks in jsPDF standard fonts)
    const formatPdfCurrency = (amount: number, isDrCr = false) => {
      const absVal = Math.abs(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      if (isDrCr) {
        if (amount === 0) return 'Rs. 0.00 (Settled)';
        return amount > 0 ? `Rs. ${absVal} Dr` : `Rs. ${absVal} Cr`;
      }
      return `Rs. ${absVal}`;
    };

    let currentY = 5;

    // 1. Crisp Centered Company Logo
    try {
      const logoData = await getOptimizedLogoData('/logo.png', 400, 0.9);
      const aspectRatio = logoData.width / logoData.height;
      const targetWidth = paperSize === '58mm' ? 24 : paperSize === '72mm' ? 28 : 32;
      const targetHeight = targetWidth / aspectRatio;
      const xPos = (docWidth - targetWidth) / 2;
      doc.addImage(logoData.dataUrl, logoData.format, xPos, currentY, targetWidth, targetHeight, undefined, 'FAST');
      currentY += targetHeight + 5.5; // Clear separation so text below never touches the logo
    } catch (e) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('GREENZAR', centerX, currentY + 4, { align: 'center' });
      currentY += 9;
    }

    // 2. Ledger Sub-title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    doc.text(`BOOK: ${ledgerName.toUpperCase()}`, centerX, currentY, { align: 'center' });
    currentY += 4.2;

    // 3. Document Title Badge (Inverted dark rectangle, centered & symmetrical)
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(leftX, currentY - 3.2, contentWidth, 6.2, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(receiptTitle.toUpperCase(), centerX, currentY + 1.2, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    currentY += 6.5;

    // Symmetrical Double Rule
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(leftX, currentY, rightX, currentY);
    currentY += 3.8;

    // 4. Symmetrical 2-Column Metadata Grid
    const col2LabelX = leftX + (contentWidth * 0.55);

    // Row 1: Voucher Ref (Left) & Date (Right)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(80, 80, 80);
    doc.text('REF :', leftX, currentY);
    doc.setTextColor(0, 0, 0);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.2);
    doc.text(formattedInvoiceNo, leftX + 14, currentY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(80, 80, 80);
    doc.text('DATE :', col2LabelX, currentY);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(formattedDate, rightX, currentY, { align: 'right' });
    currentY += 4.5;

    // Row 2: Type (Left) & Time (Right)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(80, 80, 80);
    doc.text('TYPE :', leftX, currentY);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(transaction.type === 'DEBIT' ? 'DEBIT (-)' : 'CREDIT (+)', leftX + 14, currentY);

    doc.setTextColor(80, 80, 80);
    doc.text('TIME :', col2LabelX, currentY);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(formattedTime, rightX, currentY, { align: 'right' });
    currentY += 4.5;

    // 5. Symmetrical Party Details Box
    doc.setFillColor(250, 250, 250);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    const partyBoxH = partyPhone ? 13.5 : 9.5;
    doc.roundedRect(leftX, currentY, contentWidth, partyBoxH, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(90, 90, 90);
    doc.text(`${partyLabel}:`, leftX + innerPad, currentY + 3.4);

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    const splitParty = doc.splitTextToSize(partyName.toUpperCase(), contentWidth - (innerPad * 2));
    doc.text(splitParty, leftX + innerPad, currentY + 7.4);

    if (partyPhone) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(60, 60, 60);
      doc.text(`Phone: ${partyPhone}`, leftX + innerPad, currentY + 11.4);
      doc.setTextColor(0, 0, 0);
    }
    currentY += partyBoxH + 3.5;

    // 5b. Ordered Items breakdown in PDF (if available)
    if (items && items.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text('ORDERED ITEMS', leftX, currentY);
      doc.text('AMOUNT', rightX, currentY, { align: 'right' });
      currentY += 1.8;
      doc.line(leftX, currentY, rightX, currentY);
      currentY += 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      items.forEach((it, idx) => {
        const q = Number(it.qty) || 0;
        const r = Number(it.rate) || 0;
        const tot = Number(it.line_total) || (q * r);
        const nameStr = `${idx + 1}. ${it.product_name}${it.mark_text ? ` (${it.mark_text})` : ''} [${q} pcs]`;
        doc.text(nameStr.substring(0, 34), leftX, currentY);
        doc.text(`Rs. ${tot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, rightX, currentY, { align: 'right' });
        currentY += 3.2;
      });

      doc.line(leftX, currentY, rightX, currentY);
      currentY += 3.2;
    }

    // 6. Symmetrical Financial Ledger Reconciliation Table
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    doc.line(leftX, currentY, rightX, currentY);
    currentY += 3;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('TRANSACTION RECONCILIATION', leftX, currentY);
    doc.text('AMOUNT (INR)', rightX, currentY, { align: 'right' });
    currentY += 1.8;
    doc.line(leftX, currentY, rightX, currentY);
    currentY += 4.2;

    // Row 1: Previous Outstanding Balance
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.text('1. Previous Outstanding:', leftX, currentY);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.text(formatPdfCurrency(beforeOutstanding, true), rightX, currentY, { align: 'right' });
    currentY += 4.2;

    // Row 2: This Entry
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(`2. This Entry [ ${transaction.type} ] :`, leftX, currentY);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    const entrySign = transaction.type === 'DEBIT' ? '+' : '-';
    doc.text(`${entrySign} ${formatPdfCurrency(transaction.amount, false)}`, rightX, currentY, { align: 'right' });
    currentY += 2.8;

    // Row 3: Net Closing Balance Box (High-Contrast Symmetrical Inverted Box)
    const netBoxH = 6.8;
    doc.setFillColor(0, 0, 0);
    doc.rect(leftX, currentY, contentWidth, netBoxH, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('NET CLOSING:', leftX + innerPad, currentY + 4.6);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.text(formatPdfCurrency(afterOutstanding, true), rightX - innerPad, currentY + 4.6, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    currentY += netBoxH + 3.5;

    // 7. Symmetrical Amount in Words
    const words = formatAmountInWords(transaction.amount);
    if (words) {
      doc.setDrawColor(140, 140, 140);
      doc.setLineWidth(0.2);
      doc.setFillColor(252, 252, 252);
      const wordsText = `IN WORDS: ${words.toUpperCase()}`;
      const splitWords = doc.splitTextToSize(wordsText, contentWidth - (innerPad * 2));
      const boxH = Math.max(6, 3.5 + splitWords.length * 3.4);
      doc.roundedRect(leftX, currentY, contentWidth, boxH, 1, 1, 'FD');

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.8);
      doc.text(splitWords, leftX + innerPad, currentY + 4);
      currentY += boxH + 2.8;
    }

    // 8. Particulars / Remarks
    if (transaction.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('PARTICULARS / REMARKS:', leftX, currentY);
      currentY += 3.2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const cleanNotes = transaction.notes.replace(/₹/g, 'Rs.').toUpperCase();
      const splitNotes = doc.splitTextToSize(cleanNotes, contentWidth);
      doc.text(splitNotes, leftX, currentY);
      currentY += (splitNotes.length * 3.4) + 2.5;
    }

    // 9. Symmetrical Dual Signatures Grid
    currentY += 6;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    const sigLineW = Math.min(24, (contentWidth - 6) / 2);
    const sig1StartX = leftX + 2;
    const sig1EndX = sig1StartX + sigLineW;
    const sig2EndX = rightX - 2;
    const sig2StartX = sig2EndX - sigLineW;

    doc.line(sig1StartX, currentY, sig1EndX, currentY);
    doc.line(sig2StartX, currentY, sig2EndX, currentY);
    currentY += 3.4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text("Authorized Signatory", (sig2StartX + sig2EndX) / 2, currentY, { align: 'center' });
    currentY += 5.5;

    // 10. Vector Barcode in PDF
    const barcodeWidth = Math.min(38, contentWidth - 10);
    const barcodeStartX = (docWidth - barcodeWidth) / 2;
    const hash = formattedInvoiceNo.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    let bx = barcodeStartX;
    doc.setFillColor(0, 0, 0);
    for (let i = 0; i < 34; i++) {
      const barW = ((i + hash) % 3 === 0) ? 0.85 : 0.45;
      const gap = ((i * 2 + hash) % 2 === 0) ? 0.65 : 0.45;
      if (bx + barW <= barcodeStartX + barcodeWidth) {
        doc.rect(bx, currentY, barW, 8, 'F');
      }
      bx += barW + gap;
    }
    currentY += 9.8;
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.text(`* ${formattedInvoiceNo} *`, centerX, currentY, { align: 'center' });
    currentY += 4;

    // 11. Footer Audit
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(80, 80, 80);
    doc.text('* *', centerX, currentY, { align: 'center' });
    currentY += 2.8;
    doc.text(`Printed: ${format(new Date(), 'dd-MM-yyyy HH:mm:ss')} | Ref: ${formattedInvoiceNo}`, centerX, currentY, { align: 'center' });
    doc.setTextColor(0, 0, 0);

    const cleanPrefix = receiptTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const fileName = `${cleanPrefix}_${formattedInvoiceNo}.pdf`;
    const { blob } = await exportEncryptedPdf(doc, pdfPassword);
    downloadPdfBlob(blob, fileName);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in" id="thermal-receipt-modal">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Top Header Bar */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-800 bg-zinc-950">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-[#0055a5] rounded text-white shadow-2xs">
              <Receipt size={16} />
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-zinc-100 uppercase tracking-wider">
                Official Thermal Voucher & Receipt
              </h3>
              <p className="text-[10px] text-zinc-400">Professional Print Engine • 100% Thermal & POS Ready</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Paper Size Selector (72mm vs 80mm vs 58mm) */}
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-0.5 flex items-center">
              <button
                type="button"
                onClick={() => setPaperSize('72mm')}
                className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                  paperSize === '72mm'
                    ? 'bg-[#0055a5] text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Standard 72mm Printable Thermal POS Size"
              >
                72mm
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('80mm')}
                className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                  paperSize === '80mm'
                    ? 'bg-[#0055a5] text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="80mm Wide Roll"
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('58mm')}
                className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-all ${
                  paperSize === '58mm'
                    ? 'bg-[#0055a5] text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Compact 2-inch (58mm) mobile thermal printers"
              >
                58mm
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Receipt View */}
        <div className="p-4 sm:p-6 overflow-y-auto bg-zinc-950 flex flex-col items-center flex-1">
          
          {/* Paper Receipt Physical Preview Container - Simple, clean, authentic format */}
          <div 
            ref={printRef}
            className={`bg-white text-black p-4 sm:p-5 shadow-xl relative flex flex-col font-mono select-none border border-zinc-300 transition-all duration-200 rounded-sm ${
              paperSize === '58mm' ? 'w-[230px] text-[10px]' : paperSize === '72mm' ? 'w-[275px] text-[10.5px]' : 'w-[310px] text-[11px]'
            }`}
          >
            {/* Printable Content Node */}
            <div id="thermal-receipt-print-content" className="flex flex-col text-black">
              
              {/* 1. Header */}
              <div className="text-center">
                <div className="font-extrabold text-[12px] uppercase tracking-wider text-black">
                  Greenzar Food & Beverage
                </div>
                {ledgerName && (
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wide mt-0.5">
                    {ledgerName}
                  </div>
                )}
                <div className="text-[10px] font-bold text-zinc-800 uppercase tracking-widest mt-1">
                  -- {receiptTitle} --
                </div>
              </div>

              {/* Dashed Separator */}
              <div className="border-b border-dashed border-zinc-400 my-2"></div>

              {/* 2. Bill & Party Meta */}
              <div className="space-y-1 text-[9.5px]">
                <div className="flex justify-between items-baseline">
                  <span className="text-zinc-600">Bill No: #{formattedInvoiceNo}</span>
                  <span className="text-zinc-600">{formattedDate}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-black truncate max-w-[170px]">{partyLabel}: {partyName}</span>
                  <span className="text-zinc-500 text-[8.5px]">{formattedTime}</span>
                </div>
                {partyPhone && (
                  <div className="text-zinc-600">Phone: {partyPhone}</div>
                )}
                {partyAddress && (
                  <div className="text-zinc-600 truncate">Addr: {partyAddress}</div>
                )}
                {(vehicleNumber || driverName) && (
                  <div className="flex justify-between text-zinc-600 text-[9px]">
                    {vehicleNumber && <span>Veh: {vehicleNumber}</span>}
                    {driverName && <span>Driver: {driverName}</span>}
                  </div>
                )}
              </div>

              {/* Dashed Separator */}
              <div className="border-b border-dashed border-zinc-400 my-2"></div>

              {/* 3. Items Breakdown (if present) */}
              {items && items.length > 0 && (
                <div className="text-[9.5px]">
                  <div className="flex justify-between font-bold text-zinc-700 pb-1 border-b border-dashed border-zinc-300">
                    <span className="flex-1">Item</span>
                    <span className="w-12 text-center">Qty</span>
                    <span className="w-16 text-right">Amount</span>
                  </div>
                  <div className="divide-y divide-dashed divide-zinc-200 py-1">
                    {items.map((it, idx) => {
                      const q = Number(it.qty) || 0;
                      const r = Number(it.rate) || 0;
                      const tot = Number(it.line_total) || (q * r);
                      return (
                        <div key={idx} className="py-0.5 flex justify-between items-center text-[9.5px]">
                          <span className="flex-1 truncate pr-1">
                            {idx + 1}. {it.product_name}
                            {it.mark_text && <span className="text-[8px] text-zinc-500 ml-0.5">({it.mark_text})</span>}
                          </span>
                          <span className="w-12 text-center text-zinc-700">{q}</span>
                          <span className="w-16 text-right font-bold tabular-nums">
                            ₹{tot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[9px] font-semibold text-zinc-600 pt-1 border-t border-dashed border-zinc-300">
                    <span>Total Items: {items.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)} pcs</span>
                  </div>
                  <div className="border-b border-dashed border-zinc-400 my-2"></div>
                </div>
              )}

              {/* 4. Total Amount (Prominent Simple Bold) */}
              <div className="py-1">
                <div className="flex justify-between items-baseline text-sm font-bold text-black">
                  <span>TOTAL:</span>
                  <span className="text-base font-extrabold tabular-nums">
                    ₹{transaction.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {formatAmountInWords(transaction.amount) && (
                  <div className="text-[8.5px] text-zinc-600 italic mt-0.5 leading-tight">
                    ({formatAmountInWords(transaction.amount)})
                  </div>
                )}
              </div>

              {/* 5. Balance Information (if active) */}
              {(beforeOutstanding !== 0 || afterOutstanding !== 0) && (
                <div className="text-[9px] text-zinc-700 space-y-0.5 pt-1.5 border-t border-dashed border-zinc-300 mt-1">
                  {beforeOutstanding !== 0 && (
                    <div className="flex justify-between">
                      <span>Previous Balance:</span>
                      <span className="tabular-nums">{formatBalancePlain(beforeOutstanding)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-black">
                    <span>Net Balance:</span>
                    <span className="tabular-nums">{formatBalancePlain(afterOutstanding)}</span>
                  </div>
                </div>
              )}

              {/* 6. Remarks / Particulars */}
              {transaction.notes && (
                <div className="text-[9px] text-zinc-700 pt-1.5 mt-1 border-t border-dashed border-zinc-200">
                  <span className="text-zinc-500 font-semibold">Note: </span>
                  <span className="italic">{transaction.notes}</span>
                </div>
              )}

              {/* 7. Footer Signatures & Thank You */}
              <div className="border-b border-dashed border-zinc-400 my-2.5"></div>
              <div className="flex justify-between items-end pt-3 pb-1 text-[8.5px] text-zinc-600">
                <div className="text-center w-24">
                  <div className="border-t border-dotted border-zinc-400 mb-0.5"></div>
                  <span>Receiver's Sign</span>
                </div>
                <div className="text-center w-24">
                  <div className="border-t border-dotted border-zinc-400 mb-0.5"></div>
                  <span>Authorized Sign</span>
                </div>
              </div>

              <div className="text-center text-[9px] text-zinc-500 font-semibold mt-2">
                * Thank you for your business! *
              </div>

            </div>
          </div>
          
        </div>

        {/* Security Password Lock Bar */}
        <div className="px-4 py-2.5 bg-zinc-950/90 border-t border-zinc-800">
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => setShowPassInput(!showPassInput)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-sky-400 font-medium transition-colors"
            >
              <Lock size={13} className={pdfPassword.trim() ? "text-amber-400" : "text-zinc-500"} />
              <span>{pdfPassword.trim() ? "PDF Password Encryption Active" : "Add Password Encryption to PDF"}</span>
              <span className="text-[10px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded ml-1">
                {showPassInput ? "Hide" : "Setup"}
              </span>
            </button>

            {partyPhone && !pdfPassword && (
              <button
                type="button"
                onClick={() => {
                  setPdfPassword(partyPhone.replace(/\D/g, ''));
                  setShowPassInput(true);
                }}
                className="text-[10px] text-sky-400 hover:underline flex items-center gap-1"
              >
                <Key size={10} />
                <span>Use Phone ({partyPhone.slice(-4)})</span>
              </button>
            )}
          </div>

          {showPassInput && (
            <div className="relative mt-2">
              <input
                type={showPassText ? "text" : "password"}
                placeholder="Enter password to encrypt PDF..."
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500 pr-8"
              />
              <button
                type="button"
                onClick={() => setShowPassText(!showPassText)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                {showPassText ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          )}

          {pdfPassword.trim() && (
            <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
              <Lock size={10} />
              PDF will require password: <code className="bg-zinc-800 px-1 rounded text-zinc-200">{pdfPassword}</code> to open.
            </p>
          )}
        </div>

        {/* Bluetooth Status Toast / Feedback Banner */}
        {bluetoothStatus.state !== 'idle' && (
          <div className={`px-4 py-2 text-xs flex items-center justify-between border-t ${
            bluetoothStatus.state === 'success'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
              : bluetoothStatus.state === 'error'
              ? 'bg-rose-950/80 text-rose-300 border-rose-800'
              : 'bg-blue-950/80 text-blue-300 border-blue-800'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              {bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing' ? (
                <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
              ) : bluetoothStatus.state === 'success' ? (
                <Check size={13} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle size={13} className="text-rose-400 shrink-0" />
              )}
              <span className="font-medium truncate">{bluetoothStatus.message}</span>
            </div>
            {bluetoothStatus.state === 'error' && (
              <button
                type="button"
                onClick={handleRawBtPrint}
                className="underline text-[11px] font-bold text-sky-400 hover:text-sky-300 cursor-pointer shrink-0 ml-2"
                title="Print via RawBT Android App"
              >
                Use RawBT
              </button>
            )}
          </div>
        )}

        {/* Modal Bottom Action Controls: PDF, Bluetooth Printer, System Print */}
        <div className="p-3 sm:p-4 border-t border-zinc-800 bg-zinc-950 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-200 hover:text-white text-xs font-bold hover:bg-zinc-800 active:scale-98 transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>Download PDF</span>
          </button>

          {/* Bluetooth Thermal Printer Button */}
          <button
            type="button"
            onClick={handleBluetoothPrint}
            disabled={bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 hover:from-blue-600 hover:to-indigo-600 text-white text-xs font-bold active:scale-98 transition-all shadow-md shadow-blue-950/50 cursor-pointer disabled:opacity-60"
            title="Connect and print directly to mobile Bluetooth thermal printer (POS-58, POS-80, MPT-II)"
          >
            {bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing' ? (
              <Loader2 size={14} className="animate-spin text-white" />
            ) : (
              <Bluetooth size={14} className="text-sky-200" />
            )}
            <span>
              {bluetoothStatus.state === 'printing'
                ? 'Printing...'
                : bluetoothStatus.state === 'connecting'
                ? 'Connecting...'
                : cachedBtName
                ? `BT Print (${cachedBtName})`
                : 'Bluetooth Printer'}
            </span>
          </button>
          
          {/* Standard System Print Button */}
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[#0055a5] hover:bg-[#004080] text-white text-xs font-bold active:scale-98 transition-all shadow-md shadow-blue-950/40 cursor-pointer"
            title="Open standard browser print dialog"
          >
            <Printer size={14} />
            <span>Print ({paperSize})</span>
          </button>
        </div>

      </div>
    </div>
  );
}

