import React, { useState } from 'react';
import { Download, Smartphone, Laptop, Share2, PlusSquare, X, CheckCircle2, Info } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'header' | 'mobile-item' | 'banner';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'sidebar',
  className = '',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // If already running inside standalone PWA app, hide install trigger
  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      const outcome = await install();
      if (outcome) {
        setInstallSuccess(true);
        setTimeout(() => setInstallSuccess(false), 3000);
      }
    } else {
      // Show guided instructions for iOS or desktop browsers where prompt isn't directly callable
      setShowGuideModal(true);
    }
  };

  const renderModal = () => {
    if (!showGuideModal) return null;

    return (
      <div 
        id="pwa-install-guide-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0055a5] flex items-center justify-center text-white shadow-xs">
                {isIOS ? <Smartphone size={18} /> : <Laptop size={18} />}
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {isIOS ? 'Install on iPhone / iPad' : 'Install Greenzar App'}
                </h3>
                <p className="text-[11px] text-slate-500">Fast offline access & native app feel</p>
              </div>
            </div>
            <button 
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition-colors hover:bg-slate-200/50"
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-5 space-y-4 text-xs text-slate-700">
            {isIOS ? (
              <div className="space-y-3">
                <p className="text-slate-600">
                  Follow these 2 quick steps in Safari to add Greenzar to your home screen:
                </p>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0 text-xs mt-0.5">
                    1
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block mb-0.5">Tap the Share button</span>
                    <span className="text-slate-600 leading-relaxed flex items-center gap-1.5 flex-wrap">
                      Tap <Share2 size={13} className="text-blue-600 inline" /> at the bottom or top of your Safari browser.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0 text-xs mt-0.5">
                    2
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block mb-0.5">Select Add to Home Screen</span>
                    <span className="text-slate-600 leading-relaxed flex items-center gap-1.5 flex-wrap">
                      Scroll down and tap <PlusSquare size={13} className="text-blue-600 inline" /> <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-slate-600">
                  You can install Greenzar directly as an app on your Desktop (Windows/Mac) or Android device:
                </p>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0 text-xs mt-0.5">
                    <Laptop size={12} />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block mb-0.5">On Desktop (Chrome / Edge)</span>
                    <span className="text-slate-600 leading-relaxed">
                      Click the <strong>Install</strong> icon in the address bar (top right, near the star bookmark icon) or open the browser menu (⋮) and select <strong>Install Greenzar</strong>.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0 text-xs mt-0.5">
                    <Smartphone size={12} />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block mb-0.5">On Android (Chrome / Firefox)</span>
                    <span className="text-slate-600 leading-relaxed">
                      Tap the 3 dots menu (⋮) at top right and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg text-xs transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 1. Sidebar Variant (Clean Enterprise Card in Desktop Sidebar)
  if (variant === 'sidebar') {
    return (
      <>
        <div className={`px-3 py-2 ${className}`}>
          <div className="p-2.5 bg-blue-50/70 border border-blue-200/80 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#0055a5] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <Download size={13} />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-900 block leading-tight">Install App</span>
                <span className="text-[9.5px] text-slate-500 block leading-tight">Desktop & Mobile PWA</span>
              </div>
            </div>

            <button
              type="button"
              id="pwa-install-btn-sidebar"
              onClick={handleAction}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-[#0055a5] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-all active:scale-[0.98]"
            >
              {installSuccess ? (
                <>
                  <CheckCircle2 size={13} className="text-emerald-300" />
                  <span>Installed!</span>
                </>
              ) : (
                <>
                  <Download size={13} />
                  <span>{isInstallable ? 'Install Now' : 'Install Guide'}</span>
                </>
              )}
            </button>
          </div>
        </div>
        {renderModal()}
      </>
    );
  }

  // 2. Header Variant (Compact button for top bar / header)
  if (variant === 'header') {
    return (
      <>
        <button
          type="button"
          id="pwa-install-btn-header"
          onClick={handleAction}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-[#0055a5] hover:bg-blue-100 border border-blue-200 transition-all ${className}`}
          title="Install Greenzar App"
        >
          <Download size={13} />
          <span className="hidden sm:inline">Install App</span>
        </button>
        {renderModal()}
      </>
    );
  }

  // 3. Mobile Item Variant (For mobile drawer / menu)
  if (variant === 'mobile-item') {
    return (
      <>
        <button
          type="button"
          id="pwa-install-btn-mobile"
          onClick={handleAction}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-semibold bg-blue-50 text-[#0055a5] border border-blue-200/80 transition-colors ${className}`}
        >
          <div className="flex items-center">
            <Download size={18} className="mr-3 text-[#0055a5]" />
            <span>Install App on Phone</span>
          </div>
          <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
            PWA
          </span>
        </button>
        {renderModal()}
      </>
    );
  }

  // 4. Banner Variant
  return (
    <>
      <div className={`flex items-center justify-between gap-3 p-3 bg-slate-900 text-white rounded-xl shadow-lg ${className}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0055a5] flex items-center justify-center shrink-0">
            <Download size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold truncate">Install Greenzar Application</p>
            <p className="text-[10px] text-slate-400 truncate">Run natively on desktop or phone with offline access</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAction}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shrink-0 transition-colors"
        >
          Install
        </button>
      </div>
      {renderModal()}
    </>
  );
};

export default PWAInstallButton;
