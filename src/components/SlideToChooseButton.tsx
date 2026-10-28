import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

export interface SlideToChooseButtonProps {
  value?: 'CREDIT' | 'DEBIT';
  onChange?: (val: 'CREDIT' | 'DEBIT') => void;
  onSlideComplete?: (val: 'CREDIT' | 'DEBIT') => void;
  disabled?: boolean;
  disableCredit?: boolean;
  disableDebit?: boolean;
  isSubmitting?: boolean;
  className?: string;
  size?: 'normal' | 'compact';
}

export const SlideToChooseButton: React.FC<SlideToChooseButtonProps> = ({
  value,
  onChange,
  onSlideComplete,
  disabled = false,
  disableCredit = false,
  disableDebit = false,
  isSubmitting = false,
  className = '',
  size = 'compact'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // valState: -1 (Credit), 0 (Idle / Center), 1 (Debit)
  const [valState, setValState] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const curRef = useRef<number>(0);
  const travelRef = useRef<number>(0);
  const dragRef = useRef<{ startX: number; startP: number; moved: boolean } | null>(null);
  const returnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSubmittingRef = useRef<boolean>(isSubmitting);

  const isCompact = size === 'compact';
  const handleSize = isCompact ? 48 : 52;
  const trackHeight = isCompact ? 56 : 60;
  const PAD = 3;

  // Sound synthesizer click
  const playAudioClick = useCallback((freq = 640) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.35, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (_) {}
  }, []);

  const clamp = (n: number) => Math.max(-1, Math.min(1, n));

  const getTravel = useCallback(() => {
    const trackWidth = trackRef.current?.clientWidth || 320;
    const hWidth = handleRef.current?.offsetWidth || handleSize;
    const travel = Math.max(0, (trackWidth - hWidth) / 2 - PAD);
    travelRef.current = travel;
    return travel;
  }, [handleSize]);

  // Paint immediate position (used during drag for 0ms lag 1:1 motion)
  const paint = useCallback((p: number) => {
    curRef.current = p;
    const travel = getTravel();
    const c = Math.max(0, -p);
    const d = Math.max(0, p);
    if (containerRef.current) {
      containerRef.current.style.setProperty('--c', c.toFixed(4));
      containerRef.current.style.setProperty('--d', d.toFixed(4));
    }
    if (handleRef.current) {
      handleRef.current.style.transform = `translateX(${(p * travel).toFixed(2)}px)`;
    }
  }, [getTravel]);

  // Snap to target with smooth easing
  const snapTo = useCallback((targetVal: number) => {
    curRef.current = targetVal;
    const travel = getTravel();
    if (containerRef.current) {
      containerRef.current.style.setProperty('--c', targetVal === -1 ? '1' : '0');
      containerRef.current.style.setProperty('--d', targetVal === 1 ? '1' : '0');
    }
    if (handleRef.current) {
      handleRef.current.style.transform = `translateX(${(targetVal * travel).toFixed(2)}px)`;
    }
  }, [getTravel]);

  // Measure on layout changes
  const measure = useCallback(() => {
    getTravel();
    snapTo(curRef.current);
  }, [getTravel, snapTo]);

  // Set Value & Trigger Callbacks
  const applyValue = useCallback((v: number, triggerSubmit = true) => {
    if (disabled || isSubmitting) return;

    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }

    // Check disabled constraints
    if (v === -1 && disableCredit) {
      playAudioClick(400);
      setValState(0);
      snapTo(0);
      return;
    }
    if (v === 1 && disableDebit) {
      playAudioClick(400);
      setValState(0);
      snapTo(0);
      return;
    }

    setValState(v);
    snapTo(v);

    if (v === -1) {
      playAudioClick(740);
      try { navigator.vibrate?.(20); } catch (_) {}
      onChange?.('CREDIT');
      if (triggerSubmit) onSlideComplete?.('CREDIT');
    } else if (v === 1) {
      playAudioClick(520);
      try { navigator.vibrate?.(20); } catch (_) {}
      onChange?.('DEBIT');
      if (triggerSubmit) onSlideComplete?.('DEBIT');
    }

    // Automatically return handle smoothly back to center so it never stays stuck
    // (e.g. if required fields not entered, dialog cancelled, or finished)
    if (v !== 0) {
      returnTimerRef.current = setTimeout(() => {
        if (!isSubmittingRef.current) {
          setValState(0);
          snapTo(0);
        }
      }, 650);
    }
  }, [disabled, isSubmitting, disableCredit, disableDebit, playAudioClick, snapTo, onChange, onSlideComplete]);

  // Drag Pointer Events
  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isSubmitting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}

    dragRef.current = {
      startX: e.clientX,
      startP: curRef.current,
      moved: false
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 3) {
      dragRef.current.moved = true;
    }
    if (!dragRef.current.moved) return;

    const travel = getTravel();
    if (!travel) return;

    let p = clamp(dragRef.current.startP + dx / travel);

    // Subtle elasticity resistance if credit/debit disabled
    if (disableCredit && p < 0) {
      p = Math.max(-0.15, p * 0.15);
    }
    if (disableDebit && p > 0) {
      p = Math.min(0.15, p * 0.15);
    }

    paint(p);
  };

  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (cancelled) {
      snapTo(valState);
      return;
    }

    if (d.moved) {
      const p = curRef.current;
      // Snapping threshold
      if (p < -0.32) {
        applyValue(-1, true);
      } else if (p > 0.32) {
        applyValue(1, true);
      } else {
        applyValue(0, false);
      }
    } else {
      // Tap without drag
      if (valState !== 0) {
        applyValue(0, false);
      }
    }
  };

  // Direct track tap: left third -> Credit, right third -> Debit
  const handleTrackPointerDown = (e: React.PointerEvent) => {
    if (disabled || isSubmitting) return;
    if ((e.target as HTMLElement).closest('.handle-thumb')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!trackRef.current) return;

    const r = trackRef.current.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    if (f < 1 / 3) {
      applyValue(-1, true);
    } else if (f > 2 / 3) {
      applyValue(1, true);
    } else {
      applyValue(0, false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isSubmitting) return;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowLeft' || k === 'ArrowDown') {
      applyValue(-1, true);
    } else if (k === 'ArrowRight' || k === 'ArrowUp') {
      applyValue(1, true);
    } else if (k === 'Home') {
      applyValue(-1, true);
    } else if (k === 'End') {
      applyValue(1, true);
    } else if (k === 'Escape' || k === 'Enter' || k === ' ') {
      applyValue(0, false);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  };

  // Sync submission state & auto-reset handle when not submitting
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
    if (!isSubmitting && valState !== 0) {
      const timer = setTimeout(() => {
        setValState(0);
        snapTo(0);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isSubmitting, valState, snapTo]);

  // Cleanup return timer on unmount
  useEffect(() => {
    return () => {
      if (returnTimerRef.current) {
        clearTimeout(returnTimerRef.current);
      }
    };
  }, []);

  // Setup ResizeObserver
  useEffect(() => {
    measure();
    if (trackRef.current && window.ResizeObserver) {
      const ro = new ResizeObserver(() => measure());
      ro.observe(trackRef.current);
      return () => ro.disconnect();
    } else {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
  }, [measure]);

  const valueText = valState === -1 ? 'Credit' : valState === 1 ? 'Debit' : 'Not selected';

  return (
    <div
      ref={containerRef}
      style={{
        fontFamily: '"Schibsted Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        ['--credit' as any]: '#12884b',
        ['--debit' as any]: '#d93b3b',
        ['--credit-ink' as any]: '#0d7040',
        ['--debit-ink' as any]: '#b92d2d',
        ['--track-idle' as any]: '#f1f4f7',
        ['--edge' as any]: '#e0e5eb',
        ['--handle-idle' as any]: '#ffffff',
        ['--ink' as any]: '#14181c',
        ['--ink-soft' as any]: '#66707b',
        ['--c' as any]: 0,
        ['--d' as any]: 0
      }}
      className={`w-full max-w-[340px] flex flex-col gap-2.5 select-none ${className}`}
    >
      {/* Field Label */}
      <p className="text-[13px] font-semibold text-[#66707b] tracking-[0.02em] m-0 self-start">
        Transaction type
      </p>

      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        style={{
          height: `${trackHeight}px`,
          backgroundColor:
            'color-mix(in srgb, var(--credit) calc(var(--c) * 14%), color-mix(in srgb, var(--debit) calc(var(--d) * 14%), var(--track-idle)))',
          transition: isDragging ? 'none' : 'background-color 0.28s cubic-bezier(0.22, 1, 0.36, 1)'
        }}
        className={`relative w-full border border-[#e0e5eb] rounded-full touch-pan-y select-none ${
          disabled || isSubmitting ? 'opacity-65 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
      >
        {/* Handle Thumb */}
        <div
          ref={handleRef}
          role="slider"
          tabIndex={0}
          aria-label="Transaction type"
          aria-orientation="horizontal"
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={valState}
          aria-valuetext={valueText}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
          style={{
            width: `${handleSize}px`,
            height: `${handleSize}px`,
            left: `calc(50% - ${handleSize / 2}px)`,
            top: `${PAD}px`,
            backgroundColor:
              'color-mix(in srgb, var(--credit) calc(var(--c) * 100%), color-mix(in srgb, var(--debit) calc(var(--d) * 100%), var(--handle-idle)))',
            color: 'color-mix(in srgb, #ffffff calc((var(--c) + var(--d)) * 100%), var(--ink-soft))',
            boxShadow:
              '0 4px 12px color-mix(in srgb, var(--credit) calc(var(--c) * 38%), color-mix(in srgb, var(--debit) calc(var(--d) * 38%), rgba(20, 24, 28, 0.16))), 0 0 0 1px rgba(20, 24, 28, 0.06)',
            transform: 'translateX(0px)',
            touchAction: 'none',
            willChange: 'transform',
            // CRITICAL: When dragging, transition MUST be 'none' so handle follows finger with 0 latency!
            // When not dragging, apply buttery smooth GPU-accelerated cubic-bezier ease:
            transition: isDragging
              ? 'scale 0.15s ease'
              : 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.28s ease, box-shadow 0.28s ease, color 0.28s ease, scale 0.18s ease'
          }}
          className={`handle-thumb absolute rounded-full grid place-items-center outline-none select-none ${
            isDragging ? 'scale-105 cursor-grabbing' : 'cursor-grab'
          } focus-visible:ring-2 focus-visible:ring-[#14181c] focus-visible:ring-offset-2`}
        >
          {isSubmitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              {/* Idle double-arrow icon (visible in middle) */}
              <svg
                style={{
                  opacity: 'calc(1 - var(--c) - var(--d))',
                  transition: isDragging ? 'none' : 'opacity 0.2s ease'
                }}
                className="col-start-1 row-start-1 w-[22px] h-[22px] fill-none stroke-current stroke-[1.8] stroke-round pointer-events-none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
              </svg>

              {/* Credit coins icon (fades in as handle slides left) */}
              <svg
                style={{
                  opacity: 'var(--c)',
                  transition: isDragging ? 'none' : 'opacity 0.2s ease'
                }}
                className="col-start-1 row-start-1 w-[22px] h-[22px] fill-none stroke-current stroke-[1.8] stroke-round pointer-events-none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
                <path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
              </svg>

              {/* Debit card icon (fades in as handle slides right) */}
              <svg
                style={{
                  opacity: 'var(--d)',
                  transition: isDragging ? 'none' : 'opacity 0.2s ease'
                }}
                className="col-start-1 row-start-1 w-[22px] h-[22px] fill-none stroke-current stroke-[1.8] stroke-round pointer-events-none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="M3 10h18M7 15h4" />
              </svg>
            </>
          )}
        </div>
      </div>

      {/* Labels Row */}
      <div className="flex justify-between items-center gap-3 -mt-0.5">
        {/* Credit button */}
        <button
          type="button"
          aria-pressed={valState === -1}
          disabled={disabled || isSubmitting || disableCredit}
          onClick={() => applyValue(-1, true)}
          style={{
            color: 'color-mix(in srgb, var(--credit-ink) calc(var(--c) * 100%), var(--ink-soft))',
            transition: 'color 0.25s ease'
          }}
          className={`appearance-none border-0 bg-transparent min-h-[44px] py-1.5 px-2 rounded-xl flex items-center gap-2 text-[15px] font-semibold outline-none select-none ${
            disableCredit ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'
          } focus-visible:ring-2 focus-visible:ring-[#14181c] focus-visible:ring-offset-1`}
        >
          <svg className="w-[18px] h-[18px] fill-none stroke-current stroke-[1.8] stroke-round" viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
            <path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
          </svg>
          <span>Credit</span>
        </button>

        {/* Debit button */}
        <button
          type="button"
          aria-pressed={valState === 1}
          disabled={disabled || isSubmitting || disableDebit}
          onClick={() => applyValue(1, true)}
          style={{
            color: 'color-mix(in srgb, var(--debit-ink) calc(var(--d) * 100%), var(--ink-soft))',
            transition: 'color 0.25s ease'
          }}
          className={`appearance-none border-0 bg-transparent min-h-[44px] py-1.5 px-2 rounded-xl flex items-center gap-2 text-[15px] font-semibold outline-none select-none ${
            disableDebit ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'
          } focus-visible:ring-2 focus-visible:ring-[#14181c] focus-visible:ring-offset-1`}
        >
          <span>Debit</span>
          <svg className="w-[18px] h-[18px] fill-none stroke-current stroke-[1.8] stroke-round" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="M3 10h18M7 15h4" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default SlideToChooseButton;
