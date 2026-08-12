import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Sparkles, X, RefreshCw, Check, FileText, AlertCircle, Image as ImageIcon, ArrowRight } from 'lucide-react';
import { Party } from '../types';

export interface ScannedBillResult {
  supplierName: string;
  supplierPhone?: string;
  invoiceNo: string;
  date?: string;
  items?: Array<{
    description: string;
    quantity?: number;
    price?: number;
    total: number;
  }>;
  subtotal?: number;
  tax?: number;
  totalAmount: number;
  summaryNotes?: string;
  imageBase64: string;
}

interface ScanBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  parties: Party[];
  onApplyBill: (result: ScannedBillResult, matchedParty: Party | null) => void;
}

export default function ScanBillModal({
  isOpen,
  onClose,
  parties,
  onApplyBill
}: ScanBillModalProps) {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload'>('camera');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<ScannedBillResult | null>(null);
  const [matchedParty, setMatchedParty] = useState<Party | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  useEffect(() => {
    if (isOpen && activeTab === 'camera' && !capturedImage) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab, facingMode, capturedImage]);

  const startCamera = async () => {
    stopCamera();
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setIsCameraActive(false);
      setErrorMessage("Could not access camera. Please check permissions or upload a photo from gallery.");
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setCapturedImage(dataUrl);
      stopCamera();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setCapturedImage(result);
          setErrorMessage(null);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReset = () => {
    setCapturedImage(null);
    setScannedData(null);
    setMatchedParty(null);
    setErrorMessage(null);
    if (activeTab === 'camera') {
      startCamera();
    }
  };

  const runAiOcrScan = async () => {
    if (!capturedImage) return;
    setIsScanning(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/scan-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: capturedImage,
          mimeType: 'image/jpeg'
        })
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to analyze bill with AI OCR.");
      }

      const billData = json.data;
      const fullResult: ScannedBillResult = {
        supplierName: billData.supplierName || 'Unknown Supplier',
        supplierPhone: billData.supplierPhone || '',
        invoiceNo: billData.invoiceNo || '',
        date: billData.date || '',
        items: billData.items || [],
        subtotal: billData.subtotal,
        tax: billData.tax,
        totalAmount: parseFloat(billData.totalAmount) || 0,
        summaryNotes: billData.summaryNotes || '',
        imageBase64: capturedImage
      };

      setScannedData(fullResult);

      // Attempt to auto-match supplier to existing parties list
      const supplierNameLower = (fullResult.supplierName || '').toLowerCase().trim();
      const phoneLower = (fullResult.supplierPhone || '').replace(/\D/g, '');

      let matched: Party | null = null;
      if (supplierNameLower) {
        matched = parties.find(p => p.name.toLowerCase().trim() === supplierNameLower) || null;
        if (!matched) {
          matched = parties.find(p => p.name.toLowerCase().includes(supplierNameLower) || supplierNameLower.includes(p.name.toLowerCase())) || null;
        }
      }
      if (!matched && phoneLower && phoneLower.length >= 6) {
        matched = parties.find(p => p.phone && p.phone.replace(/\D/g, '').includes(phoneLower)) || null;
      }

      setMatchedParty(matched);
    } catch (err: any) {
      console.error("AI Scan error:", err);
      setErrorMessage(err.message || "An error occurred while scanning the purchase bill.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirmAndApply = () => {
    if (scannedData) {
      onApplyBill(scannedData, matchedParty);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-gray-100 dark:border-gray-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/80 dark:bg-gray-950/80">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 rounded-xl">
              <Sparkles size={18} />
            </span>
            <div>
              <h3 className="font-extrabold text-gray-900 dark:text-white text-base tracking-tight leading-tight">
                AI Scan Physical Purchase Bill
              </h3>
              <p className="text-[11px] text-gray-500 font-medium leading-none mt-0.5">
                Capture & OCR auto-extract bill details with Gemini AI
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {!capturedImage ? (
            <div>
              {/* Tab Selector */}
              <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl mb-4">
                <button
                  type="button"
                  onClick={() => { setActiveTab('camera'); setCapturedImage(null); }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'camera' ? 'bg-white dark:bg-gray-900 text-sky-600 dark:text-sky-400 shadow-xs' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  <Camera size={16} />
                  Live Camera
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('upload'); setCapturedImage(null); }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'upload' ? 'bg-white dark:bg-gray-900 text-sky-600 dark:text-sky-400 shadow-xs' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  <Upload size={16} />
                  Upload Photo
                </button>
              </div>

              {activeTab === 'camera' ? (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center border border-gray-200 dark:border-gray-800">
                  <video 
                    ref={videoRef} 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Viewfinder Overlay Frame */}
                  <div className="absolute inset-4 border-2 border-dashed border-sky-400/70 rounded-xl pointer-events-none flex items-center justify-center">
                    <span className="text-[10px] uppercase font-extrabold text-white bg-black/50 px-2 py-1 rounded-md backdrop-blur-xs">
                      Position Purchase Bill Inside Frame
                    </span>
                  </div>

                  {/* Camera Flip Button */}
                  <button
                    type="button"
                    onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
                    className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-xs cursor-pointer"
                    title="Flip Camera"
                  >
                    <RefreshCw size={16} />
                  </button>

                  {/* Capture Trigger Button */}
                  <div className="absolute bottom-4 inset-x-0 flex justify-center">
                    <button
                      type="button"
                      onClick={handleCaptureSnapshot}
                      disabled={!isCameraActive}
                      className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-extrabold text-xs rounded-full shadow-lg flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      <Camera size={18} />
                      Capture Snapshot
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-sky-200 dark:border-sky-900/60 hover:border-sky-500 dark:hover:border-sky-500 bg-sky-50/30 dark:bg-sky-950/20 rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-3"
                >
                  <input 
                    ref={fileInputRef} 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    onChange={handleFileChange} 
                    className="hidden" 
                  />
                  <div className="w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                    <ImageIcon size={24} />
                  </div>
                  <div>
                    <span className="font-bold text-gray-900 dark:text-white text-sm block">Click or tap to upload bill photo</span>
                    <span className="text-xs text-gray-400 mt-0.5 block">Supports JPG, PNG, WEBP from camera or device files</span>
                  </div>
                </div>
              )}
            </div>
          ) : !scannedData ? (
            /* Snapshot Preview & AI Scan Trigger */
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 border border-gray-200 dark:border-gray-800 max-h-72 flex justify-center">
                <img 
                  src={capturedImage} 
                  alt="Bill Preview" 
                  className="object-contain max-h-72 w-auto"
                />
                {isScanning && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center">
                    <div className="w-12 h-12 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <div className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Sparkles size={16} className="text-amber-400 animate-pulse" />
                      AI OCR Scanning Physical Bill...
                    </div>
                    <p className="text-xs text-gray-300 mt-1 max-w-xs">Reading supplier name, invoice no, line items, and total amount...</p>
                  </div>
                )}
              </div>

              {!isScanning && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    Retake / Change Photo
                  </button>
                  <button
                    type="button"
                    onClick={runAiOcrScan}
                    className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-extrabold text-xs shadow-md shadow-sky-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Sparkles size={16} />
                    Scan Bill with AI
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Scanned Bill Result Preview & Confirmation */
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                  <Check size={16} className="text-emerald-600" />
                  <span>Bill Scanned Successfully!</span>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-[11px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 underline cursor-pointer"
                >
                  Scan Another
                </button>
              </div>

              {/* Parsed Bill Card */}
              <div className="p-4 bg-gray-50 dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Supplier / Vendor</span>
                    <span className="font-extrabold text-gray-900 dark:text-white text-sm block truncate">
                      {scannedData.supplierName}
                    </span>
                    {matchedParty ? (
                      <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                        Matched: {matchedParty.name}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5 block">
                        Will search or create party
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Invoice / Bill No</span>
                    <span className="font-mono font-bold text-gray-900 dark:text-white text-sm block">
                      {scannedData.invoiceNo || 'N/A'}
                    </span>
                    {scannedData.date && (
                      <span className="text-[10px] text-gray-400 block font-medium mt-0.5">Date: {scannedData.date}</span>
                    )}
                  </div>
                </div>

                {/* Amount Summary */}
                <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-150 dark:border-gray-800 flex justify-between items-center">
                  <div>
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Grand Total Bill Amount</span>
                    <span className="text-xl font-black text-rose-600 dark:text-rose-400">
                      ₹{scannedData.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-right text-[11px] text-gray-500">
                    {scannedData.tax ? <div>Tax: ₹{scannedData.tax.toFixed(2)}</div> : null}
                    {scannedData.items ? <div>Items: {scannedData.items.length} listed</div> : null}
                  </div>
                </div>

                {/* Items List Table */}
                {scannedData.items && scannedData.items.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Line Items Extracted</span>
                    <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 max-h-36 overflow-y-auto">
                      {scannedData.items.map((it, idx) => (
                        <div key={idx} className="p-2 flex justify-between items-center text-xs">
                          <div className="min-w-0 pr-2">
                            <div className="font-bold text-gray-800 dark:text-gray-200 truncate">{it.description}</div>
                            {it.quantity ? (
                              <div className="text-[10px] text-gray-400">{it.quantity} x ₹{it.price ? it.price.toFixed(2) : '-'}</div>
                            ) : null}
                          </div>
                          <div className="font-extrabold text-gray-900 dark:text-white shrink-0">₹{it.total ? it.total.toFixed(2) : '0.00'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/80 flex justify-between items-center">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {scannedData && (
            <button
              type="button"
              onClick={handleConfirmAndApply}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white rounded-xl font-extrabold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <span>Auto-fill Entry Details</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
