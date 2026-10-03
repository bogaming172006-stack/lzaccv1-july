import React, { useState, useEffect, useCallback, useRef } from 'react';

// Global singleton state for Caps Lock detection across the app
let globalPhysicalCapsLock = false;
let globalManualOverride: boolean | null = null;
const listeners = new Set<(isCaps: boolean) => void>();

function notifyListeners() {
  const current = getEffectiveCapsLock();
  listeners.forEach(cb => cb(current));
}

function getEffectiveCapsLock(): boolean {
  if (globalManualOverride !== null) {
    return globalManualOverride;
  }
  return globalPhysicalCapsLock;
}

if (typeof window !== 'undefined') {
  const handleKeyEvent = (e: KeyboardEvent) => {
    if (e.getModifierState) {
      const physicalState = e.getModifierState('CapsLock');
      if (physicalState !== globalPhysicalCapsLock) {
        globalPhysicalCapsLock = physicalState;
        // If user physically presses CapsLock key, clear manual override to respect physical key
        if (e.key === 'CapsLock') {
          globalManualOverride = null;
        }
        notifyListeners();
      }
    }
  };

  window.addEventListener('keydown', handleKeyEvent, true);
  window.addEventListener('keyup', handleKeyEvent, true);
}

/**
 * Converts text so that the first letter of EVERY word is uppercase,
 * and all subsequent letters in that word are lowercase:
 * e.g. "kolkata sector5 freea" -> "Kolkata Sector5 Freea"
 * Words are separated by whitespace, punctuation, symbols, or brackets.
 * Contractions/possessives like "party's" or "don't" preserve lowercase after the apostrophe.
 */
export function toTitleCase(text: string): string {
  if (!text) return text;
  const lower = text.toLowerCase();

  return lower.replace(/(^|[^\p{L}\p{N}\x27\u2019]+|[\x27\u2019]+(?!\p{L}))(\p{L})/gu, (_, prefix, char) => {
    return prefix + char.toUpperCase();
  });
}

/**
 * Formats text based on whether Caps Lock is ON or OFF.
 * - Caps Lock ON: ALL CAPS ONLY (e.g. "KOLKATA SECTOR5 FREEA")
 * - Caps Lock OFF: Capitalize Every Word (e.g. "Kolkata Sector5 Freea")
 */
export function formatLedgerText(text: string, forceCaps?: boolean): string {
  if (!text) return text;
  const isCaps = forceCaps !== undefined ? forceCaps : getEffectiveCapsLock();
  if (isCaps) {
    return text.toUpperCase();
  }
  return toTitleCase(text);
}

/**
 * Hook for ledger components to track Caps Lock and handle input text formatting smoothly.
 */
export function useLedgerTextCase() {
  const [isCaps, setIsCaps] = useState<boolean>(getEffectiveCapsLock());

  useEffect(() => {
    const handler = (newVal: boolean) => setIsCaps(newVal);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const toggleManualCaps = useCallback(() => {
    if (globalManualOverride === null) {
      globalManualOverride = !globalPhysicalCapsLock;
    } else {
      globalManualOverride = !globalManualOverride;
    }
    notifyListeners();
  }, []);

  const handleTextChange = useCallback((
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    setter: (val: string) => void
  ) => {
    const target = e.target;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const original = target.value;
    const formatted = formatLedgerText(original, isCaps);

    setter(formatted);

    // Maintain cursor position
    if (start !== null && end !== null) {
      requestAnimationFrame(() => {
        if (target) {
          target.setSelectionRange(start, end);
        }
      });
    }
  }, [isCaps]);

  return {
    isCaps,
    toggleManualCaps,
    formatText: (text: string) => formatLedgerText(text, isCaps),
    handleTextChange,
  };
}

/**
 * Compact visual indicator showing whether Caps Lock is ON or OFF,
 * and allowing 1-click toggling between ALL CAPS and Sentence Case.
 */
export const CaseIndicator: React.FC<{
  isCaps: boolean;
  onToggle: () => void;
  className?: string;
}> = ({ isCaps, onToggle, className = '' }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        isCaps
          ? 'Caps Lock is ON: Text will be in ALL CAPS. Click to switch to Capitalize Every Word.'
          : 'Caps Lock is OFF: First letter of every word is capitalized (e.g. Kolkata Sector5 Freea). Click to switch to ALL CAPS.'
      }
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer select-none ${
        isCaps
          ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
          : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
      } ${className}`}
    >
      {isCaps ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span>
          <span className="font-bold">CAPS ON</span>
        </>
      ) : (
        <>
          <span className="font-bold text-slate-700 font-mono text-[9px] px-0.5 bg-white border border-slate-200 rounded">Aa</span>
          <span>Capitalize Words</span>
        </>
      )}
    </button>
  );
};
