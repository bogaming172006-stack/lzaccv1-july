import React, { useRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import { X, Printer, Download, Receipt, Lock, Eye, EyeOff, Key, SlidersHorizontal, Check } from 'lucide-react';
import { Transaction, Ledger } from '../types';
import CompanyLogo, { loadImage, getOptimizedLogoData } from './CompanyLogo';
import { exportEncryptedPdf, downloadPdfBlob } from '../lib/pdfEncrypt';
import { formatAmountInWords } from '../lib/numberToWords';

interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  partyName: string;
  partyPhone?: string;
  ledgerName: string;
  ledgerType?: Ledger['type'];
  isPurchaseStyle?: boolean;
  autoPrint?: boolean;
  customTitle?: string;
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
  ledgerName,
  ledgerType,
  isPurchaseStyle = false,
  autoPrint = false,
  customTitle
}: ThermalReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [paperSize, setPaperSize] = useState<'72mm' | '80mm' | '58mm'>('72mm');
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPassInput, setShowPassInput] = useState(false);
  const [showPassText, setShowPassText] = useState(false);

  const receiptTitle = customTitle || getReceiptTitle(ledgerType, transaction.type);
  const partyLabel = getPartyLabel(ledgerType, transaction.type);

  const afterOutstanding = transaction.runningBalance ?? 0;
  const balanceChange = transaction.type === 'DEBIT' ? transaction.amount : -transaction.amount;
  const beforeOutstanding = afterOutstanding - balanceChange;

  const formatBalancePlain = (amount: number) => {
    if (amount === 0) return '0.00';
    const absVal = Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount > 0 ? `₹${absVal} Dr` : `₹${absVal} Cr`;
  };

  const formattedInvoiceNo = (transaction.invoiceNo || transaction.id.substring(0, 8)).toUpperCase();
  const txDate = new Date(transaction.timestamp);
  const formattedDate = format(txDate, 'dd MMM yyyy');
  const formattedTime = format(txDate, 'hh:mm a');

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
          
          {/* Paper Receipt Physical Preview Container */}
          <div 
            ref={printRef}
            className={`bg-white text-black pt-2 px-3.5 pb-4 shadow-2xl relative flex flex-col font-sans select-none border border-zinc-300 transition-all duration-200 rounded-xs ${
              paperSize === '58mm' ? 'w-[230px] text-[10px]' : paperSize === '72mm' ? 'w-[275px] text-[10.5px]' : 'w-[310px] text-[11px]'
            }`}
            style={{ minHeight: '340px' }}
          >
            {/* Top jagged/tear receipt perforation */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-[linear-gradient(45deg,transparent_33.333%,#09090b_33.333%,#09090b_66.667%,transparent_66.667%)] bg-[length:6px_6px]"></div>
            
            {/* Printable Content Node */}
            <div id="thermal-receipt-print-content" className="pt-1 flex flex-col text-black">
              
              {/* 1. Header with Company Logo */}
              <div className="logo-container flex justify-center items-center w-full mt-1 mb-2.5 text-center">
                <CompanyLogo className={`${paperSize === '58mm' ? 'h-8' : paperSize === '72mm' ? 'h-9' : 'h-10'} w-auto object-contain mx-auto`} variant="dark" />
              </div>

              {/* Organization & Ledger Sub-titles */}
              <div className="text-center font-extrabold text-[12px] uppercase tracking-wider text-black header-org leading-normal mt-0.5 mb-1">
                Greenzar Food & Beverage
              </div>
              <div className="text-center uppercase text-[8.5px] font-semibold tracking-wide text-zinc-600 mb-0.5 header-sub">
                Book: <span className="font-bold text-black">{ledgerName}</span>
              </div>

              {/* High-Contrast Voucher Title Badge */}
              <div className="text-center my-1">
                <span className="voucher-badge inline-block bg-black text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded uppercase tracking-wider shadow-2xs">
                  {receiptTitle}
                </span>
              </div>

              {/* Double Line Divider */}
              <div className="border-t border-b border-black h-[3px] my-1.5 rule-double"></div>

              {/* 2. Structured Meta Info Grid */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 my-1 text-[9.5px] meta-grid">
                <div className="flex flex-col meta-item">
                  <span className="text-[8px] uppercase text-zinc-500 font-bold meta-label">Ref:</span>
                  <span className="font-mono font-bold text-black text-[10.5px] meta-val">{formattedInvoiceNo}</span>
                </div>
                <div className="flex flex-col text-right meta-item">
                  <span className="text-[8px] uppercase text-zinc-500 font-bold meta-label">Date:</span>
                  <span className="font-bold text-black meta-val">{formattedDate}</span>
                </div>
                <div className="flex flex-col meta-item">
                  <span className="text-[8px] uppercase text-zinc-500 font-bold meta-label">Time:</span>
                  <span className="font-medium text-black meta-val">{formattedTime}</span>
                </div>
                <div className="flex flex-col text-right meta-item">
                  <span className="text-[8px] uppercase text-zinc-500 font-bold meta-label">Adjustment Type:</span>
                  <span className={`font-bold meta-val ${transaction.type === 'DEBIT' ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {transaction.type === 'DEBIT' ? 'DEBIT (-)' : 'CREDIT (+)'}
                  </span>
                </div>
              </div>

              {/* 3. Party Information Card */}
              <div className="border border-black/80 rounded p-1.5 my-1.5 bg-zinc-50/80 party-box">
                <div className="text-[8px] uppercase text-zinc-600 font-bold party-tag">
                  {partyLabel}:
                </div>
                <div className="font-extrabold text-black text-[12px] leading-snug party-name break-words">
                  {partyName.toUpperCase()}
                </div>
                {partyPhone && (
                  <div className="text-[9.5px] font-mono text-zinc-700 mt-0.5">
                    Phone: <span className="font-semibold">{partyPhone}</span>
                  </div>
                )}
              </div>

              {/* 4. Complete Accounting Reconciliation Statement */}
              <div className="my-1.5 recon-section">
                <div className="flex justify-between items-center text-[8.5px] font-bold uppercase tracking-wider text-zinc-600 border-b border-black pb-0.5 mb-1 recon-header">
                  <span>Particulars</span>
                  <span>Amount (₹)</span>
                </div>

                {/* Row 1: Previous Outstanding */}
                <div className="flex justify-between items-center py-0.5 text-[9.5px] recon-row">
                  <span className="text-zinc-700">1. Previous Balance:</span>
                  <span className="font-mono font-bold text-black tabular-nums">
                    {formatBalancePlain(beforeOutstanding)}
                  </span>
                </div>

                {/* Row 2: This Transaction Entry */}
                <div className="flex justify-between items-center py-0.5 text-[10.5px] font-bold recon-row">
                  <span>2. This Entry ({transaction.type}):</span>
                  <span className={`font-mono tabular-nums ${transaction.type === 'DEBIT' ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {transaction.type === 'DEBIT' ? '+' : '-'}₹{transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Row 3: Net Current Closing Balance */}
                <div className="net-closing-box flex justify-between items-center py-1 px-1.5 bg-black text-white font-bold rounded my-1 text-[11px] shadow-2xs">
                  <span className="uppercase text-[9.5px] tracking-wide text-white">Net Current Balance:</span>
                  <span className="font-mono tabular-nums text-white">
                    {formatBalancePlain(afterOutstanding)}
                  </span>
                </div>
              </div>

              {/* 5. Live Amount in Words */}
              {formatAmountInWords(transaction.amount) && (
                <div className="border border-zinc-400/80 rounded px-1.5 py-1 text-[8.5px] italic text-zinc-800 leading-tight uppercase bg-zinc-50/80 my-1 words-box">
                  <span className="font-bold not-italic text-[8px] block text-zinc-500">In Words:</span>
                  INR {formatAmountInWords(transaction.amount).toUpperCase()}
                </div>
              )}

              {/* 6. Remarks / Particulars Note */}
              {transaction.notes && (
                <div className="border-l-2 border-black pl-1.5 py-0.5 my-1.5 text-[9px] notes-box">
                  <span className="font-bold uppercase text-black block text-[8px]">Particulars / Remarks:</span>
                  <span className="italic text-zinc-800 break-words">{transaction.notes.toUpperCase()}</span>
                </div>
              )}

              {/* 7. Dual Authorization Signatures */}
              <div className="flex justify-between items-end mt-4 mb-2 pt-2 text-center text-[8px] uppercase font-bold text-black signatures-grid">
                <div className="flex flex-col items-center flex-1 sig-col">
                  <div className="w-4/5 border-t border-dotted border-black mb-1 sig-line"></div>
                  <span>Receiver's Sign</span>
                </div>
                <div className="flex flex-col items-center flex-1 sig-col">
                  <div className="w-4/5 border-t border-dotted border-black mb-1 sig-line"></div>
                  <span>Authorized Sign</span>
                </div>
              </div>

              {/* 8. Barcode & Audit Footer */}
              <ReceiptBarcode value={formattedInvoiceNo} isNarrow={paperSize === '58mm'} />

              <div className="text-center text-[7.5px] text-zinc-600 mt-0.5 leading-tight footer-audit">
                <div>* Computer Generated Accounting Voucher *</div>
                <div className="font-semibold text-black">Thank you for your business!</div>
              </div>

            </div>

            {/* Bottom jagged/tear receipt perforation */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-[linear-gradient(-45deg,transparent_33.333%,#09090b_33.333%,#09090b_66.667%,transparent_66.667%)] bg-[length:6px_6px]"></div>
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

        {/* Modal Bottom Action Controls */}
        <div className="p-3.5 sm:p-4 border-t border-zinc-800 bg-zinc-950 flex gap-2.5">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-200 hover:text-white text-xs font-bold hover:bg-zinc-800 active:scale-98 transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>Download PDF</span>
          </button>
          
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#0055a5] hover:bg-[#004080] text-white text-xs font-bold active:scale-98 transition-all shadow-md shadow-blue-950/40 cursor-pointer"
          >
            <Printer size={15} />
            <span>Print Receipt ({paperSize})</span>
          </button>
        </div>

      </div>
    </div>
  );
}

