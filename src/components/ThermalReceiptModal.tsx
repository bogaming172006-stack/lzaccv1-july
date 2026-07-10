import React, { useRef, useEffect } from 'react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import { X, Printer, Download, Receipt } from 'lucide-react';
import { Transaction } from '../types';
import CompanyLogo, { loadImage } from './CompanyLogo';

interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  partyName: string;
  partyPhone?: string;
  ledgerName: string;
  isPurchaseStyle: boolean;
  autoPrint?: boolean;
}

export default function ThermalReceiptModal({
  isOpen,
  onClose,
  transaction,
  partyName,
  partyPhone,
  ledgerName,
  isPurchaseStyle,
  autoPrint = false
}: ThermalReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const afterOutstanding = transaction.runningBalance ?? 0;
  const balanceChange = transaction.type === 'DEBIT' ? transaction.amount : -transaction.amount;
  const beforeOutstanding = afterOutstanding - balanceChange;

  const formatBalancePlain = (amount: number) => {
    if (amount === 0) return '0.00';
    const absVal = Math.abs(amount).toFixed(2);
    return amount > 0 ? `${absVal} Dr` : `${absVal} Cr`;
  };

  const handlePrint = () => {
    const printContent = document.getElementById('thermal-receipt-print-content');
    if (!printContent) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!iframeDoc) return;

    iframeDoc.open();
    iframeDoc.write(`
      <html>
        <head>
          <title>Receipt Print</title>
          <style>
            @page {
              size: 73mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: 11px;
              line-height: 1.3;
              color: #000;
              background: #fff;
              margin: 0;
              padding: 2mm 3mm;
              width: 73mm;
              box-sizing: border-box;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-bold { font-weight: bold; }
            .logo-container { display: flex; justify-content: center; width: 100%; margin: 0 auto 6px auto; }
            .logo-container svg { width: 180px; height: auto; }
            .header-title { font-size: 15px; font-weight: bold; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
            .header-subtitle { font-size: 9px; margin-bottom: 4px; text-transform: uppercase; color: #333; }
            .header-type { font-size: 11px; font-weight: bold; background-color: #000; color: #fff; padding: 2px 4px; display: inline-block; margin: 4px 0; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .double-divider { border-top: 1px double #000; margin: 6px 0; }
            .flex-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 3px; }
            .flex-row span:first-child { text-transform: uppercase; font-weight: bold; }
            .outstanding-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 11.5px; margin: 4px 0; }
            .notes-section { word-break: break-all; margin-top: 6px; font-size: 10px; line-height: 1.2; }
            .notes-title { font-weight: bold; text-transform: uppercase; }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    iframeDoc.close();

    // Trigger printing safely from the parent window context to prevent sandbox issues
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Iframe printing blocked, calling window.print() directly", err);
        window.print();
      }

      // Safe clean up from the parent document
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch (e) {}
      }, 500);
    }, 250);
  };

  // Automatically trigger printing if autoPrint is true on open
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
    const doc = new jsPDF({
      unit: 'mm',
      format: [73, 136],
      orientation: 'portrait'
    });

    let logoBottom = 16;
    try {
      const img = await loadImage('/logo.png');
      const imgWidth = img.naturalWidth || img.width || 100;
      const imgHeight = img.naturalHeight || img.height || 100;
      const aspectRatio = imgWidth / imgHeight;
      const targetWidth = 44;
      const targetHeight = targetWidth / aspectRatio;
      const xPos = 36.5 - (targetWidth / 2);
      doc.addImage(img, 'PNG', xPos, 4, targetWidth, targetHeight);
      logoBottom = 4 + targetHeight;
    } catch (e) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(14);
      doc.text('GREENZAR', 36.5, 9, { align: 'center' });
      
      doc.setFont('courier', 'bold');
      doc.setFontSize(6.5);
      doc.text('FOOD & BEVERAGE', 36.5, 12, { align: 'center' });
      logoBottom = 15;
    }
    
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(ledgerName.toUpperCase(), 36.5, logoBottom + 3, { align: 'center' });
    
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text('AUDIT LOG RECEIPT', 36.5, logoBottom + 8, { align: 'center' });
    
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text('--------------------------------------', 36.5, logoBottom + 12, { align: 'center' });
    
    doc.text(`RECEIPT NO : ${transaction.invoiceNo || transaction.id.substring(0, 8).toUpperCase()}`, 5, logoBottom + 17);
    doc.text(`DATE       : ${format(new Date(transaction.timestamp), 'dd MMM yyyy, hh:mm a').toUpperCase()}`, 5, logoBottom + 22);
    doc.text(`PARTY      : ${partyName.toUpperCase()}`, 5, logoBottom + 27);
    if (partyPhone) {
      doc.text(`PHONE      : ${partyPhone}`, 5, logoBottom + 32);
    }
    
    const secondLineY = partyPhone ? (logoBottom + 36) : (logoBottom + 31);
    doc.text('--------------------------------------', 36.5, secondLineY, { align: 'center' });
    
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.text('TRANSACTION AUDIT', 36.5, secondLineY + 5, { align: 'center' });
    
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text('--------------------------------------', 36.5, secondLineY + 10, { align: 'center' });
    
    // Before outstanding
    doc.text('BEFORE OUTSTANDING:', 5, secondLineY + 16);
    doc.text(formatBalancePlain(beforeOutstanding), 68, secondLineY + 16, { align: 'right' });
    
    // This entry
    doc.setFont('courier', 'bold');
    doc.text(`THIS ENTRY (${transaction.type}):`, 5, secondLineY + 22);
    doc.text(`INR ${transaction.amount.toFixed(2)}`, 68, secondLineY + 22, { align: 'right' });
    
    doc.setFont('courier', 'normal');
    doc.text('--------------------------------------', 36.5, secondLineY + 27, { align: 'center' });
    
    // After outstanding
    doc.setFont('courier', 'bold');
    doc.text('AFTER OUTSTANDING:', 5, secondLineY + 33);
    doc.text(formatBalancePlain(afterOutstanding), 68, secondLineY + 33, { align: 'right' });
    
    doc.setFont('courier', 'normal');
    doc.text('--------------------------------------', 36.5, secondLineY + 38, { align: 'center' });
    
    // Particulars
    let y = secondLineY + 43;
    if (transaction.notes) {
      doc.setFont('courier', 'bold');
      doc.text('NOTES:', 5, y);
      doc.setFont('courier', 'normal');
      const splitNotes = doc.splitTextToSize(transaction.notes.replace(/₹/g, 'Rs.').toUpperCase(), 63);
      doc.text(splitNotes, 5, y + 4);
      y += 4 + (splitNotes.length * 4);
    }
    
    doc.text('--------------------------------------', 36.5, y + 2, { align: 'center' });
    
    doc.save(`audit_receipt_${transaction.invoiceNo || transaction.id.substring(0, 8)}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" id="thermal-receipt-modal">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-950/80">
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-sky-500" />
            <h3 className="font-semibold text-sm text-zinc-100 uppercase tracking-wider">
              Thermal 3" Receipt Print (73mm)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 p-1 rounded-full hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content - Receipt Container */}
        <div className="p-6 overflow-y-auto bg-zinc-950 flex flex-col items-center flex-1">
          
          {/* Stylized Paper Receipt Preview - Exactly 276px for 73mm preview equivalence */}
          <div 
            ref={printRef}
            className="w-[276px] bg-white text-black p-4 shadow-inner relative flex flex-col font-mono text-[11px] border border-zinc-200 select-none leading-relaxed"
            style={{ minHeight: '300px' }}
          >
            {/* Top jagged/tear design */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-[linear-gradient(45deg,transparent_33.333%,#18181b_33.333%,#18181b_66.667%,transparent_66.667%)] bg-[length:6px_6px]"></div>
            
             {/* Inner Print Content */}
            <div id="thermal-receipt-print-content" className="pt-2 flex flex-col h-full text-black">
              <div className="logo-container">
                <CompanyLogo className="h-16 w-auto" variant="dark" />
              </div>
              <div className="text-center uppercase text-[8.5px] font-semibold tracking-wide text-zinc-600 mb-1 header-subtitle">
                {ledgerName}
              </div>
              <div className="text-center font-bold text-[10.5px] bg-zinc-900 text-white py-0.5 px-2 mb-2 inline-block mx-auto header-type">
                AUDIT LOG RECEIPT
              </div>
              
              <div className="divider border-t border-dashed border-black my-1"></div>
              
              <div className="flex justify-between font-mono text-[10px] text-zinc-800 mb-0.5">
                <span className="font-bold">RECEIPT NO:</span>
                <span className="font-bold">{transaction.invoiceNo || transaction.id.substring(0, 8).toUpperCase()}</span>
              </div>
              <div className="flex justify-between font-mono text-[10px] text-zinc-800 mb-0.5">
                <span className="font-bold">DATE:</span>
                <span>{format(new Date(transaction.timestamp), 'dd MMM yyyy, hh:mm a').toUpperCase()}</span>
              </div>
              <div className="flex justify-between font-mono text-[10px] text-zinc-800 mb-0.5">
                <span className="font-bold">PARTY:</span>
                <span className="font-bold">{partyName.toUpperCase()}</span>
              </div>
              {partyPhone && (
                <div className="flex justify-between font-mono text-[10px] text-zinc-800 mb-0.5">
                  <span className="font-bold">PHONE:</span>
                  <span>{partyPhone}</span>
                </div>
              )}
              
              <div className="divider border-t border-dashed border-black my-2"></div>
              
              <div className="text-center font-bold text-[10px] uppercase tracking-widest mb-2">
                TRANSACTION AUDIT
              </div>
              
              <div className="flex justify-between font-mono text-[10.5px] py-0.5">
                <span className="font-bold">BEFORE OUTSTANDING:</span>
                <span className="font-medium">{formatBalancePlain(beforeOutstanding)}</span>
              </div>
              
              <div className="flex justify-between font-mono text-[10.5px] py-1 text-black bg-zinc-100 px-1 my-1 rounded-sm border-y border-dashed border-zinc-300">
                <span className="font-bold">THIS ENTRY ({transaction.type}):</span>
                <span className="font-bold">₹{transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              
              <div className="divider border-t border-dashed border-black my-1.5"></div>
              
              <div className="flex justify-between font-mono text-[11.5px] font-bold py-1 bg-zinc-900 text-white px-1.5 outstanding-row">
                <span>AFTER OUTSTANDING:</span>
                <span>{formatBalancePlain(afterOutstanding)}</span>
              </div>
              
              <div className="divider border-t border-dashed border-black my-2"></div>
              
              {transaction.notes && (
                <div className="notes-section flex flex-col font-mono text-[10px] text-zinc-800 leading-tight">
                  <span className="font-bold notes-title">NOTES:</span>
                  <span className="mt-1 break-words italic">{transaction.notes.toUpperCase()}</span>
                </div>
              )}
              
              <div className="divider border-t border-dashed border-black my-2"></div>
            </div>

            {/* Bottom jagged/tear effect */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-[linear-gradient(-45deg,transparent_33.333%,#18181b_33.333%,#18181b_66.667%,transparent_66.667%)] bg-[length:6px_6px]"></div>
          </div>
          
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex gap-3">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-200 hover:text-white text-xs font-semibold hover:bg-zinc-800 active:scale-95 transition-all"
          >
            <Download size={14} />
            Download PDF
          </button>
          
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold active:scale-95 transition-all shadow-md shadow-sky-900/20"
          >
            <Printer size={14} />
            Print Receipt
          </button>
        </div>

      </div>
    </div>
  );
}
