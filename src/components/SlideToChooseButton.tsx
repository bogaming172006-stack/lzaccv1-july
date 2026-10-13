import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface SlideToChooseButtonProps {
  value: 'CREDIT' | 'DEBIT';
  onChange?: (val: 'CREDIT' | 'DEBIT') => void;
  onSlideComplete?: (val: 'CREDIT' | 'DEBIT') => void;
  disabled?: boolean;
  disableCredit?: boolean;
  disableDebit?: boolean;
  isSubmitting?: boolean;
  className?: string;
}

export const SlideToChooseButton: React.FC<SlideToChooseButtonProps> = ({
  value,
  onChange,
  onSlideComplete,
  disabled = false,
  disableCredit = false,
  disableDebit = false,
  isSubmitting = false,
  className = ''
}) => {
  const [internalState, setInternalState] = useState<'credit' | 'debit'>(
    disableDebit ? 'credit' : (value === 'CREDIT' ? 'credit' : 'debit')
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0); // Offset from center in px
  const [reachedSide, setReachedSide] = useState<'credit' | 'debit' | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const dragStartXRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const currentOffsetRef = useRef<number>(0);

  // Sync external value
  useEffect(() => {
    if (disableDebit) {
      setInternalState('credit');
    } else if (disableCredit) {
      setInternalState('debit');
    } else {
      setInternalState(value === 'CREDIT' ? 'credit' : 'debit');
    }
  }, [value, disableDebit, disableCredit]);

  // Web Audio API Synthesizer Click Sound
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

  const triggerChoice = useCallback((choice: 'credit' | 'debit', triggerSubmit = true) => {
    if (choice === 'credit' && disableCredit) {
      playAudioClick(400);
      return;
    }
    if (choice === 'debit' && disableDebit) {
      playAudioClick(400);
      return;
    }

    setInternalState(choice);
    setDragOffset(0);
    setReachedSide(null);
    currentOffsetRef.current = 0;

    if (choice === 'credit') {
      playAudioClick(740);
    } else {
      playAudioClick(520);
    }

    try {
      navigator.vibrate?.(25);
    } catch (_) {}

    const upperChoice = choice === 'credit' ? 'CREDIT' : 'DEBIT';
    onChange?.(upperChoice);
    if (triggerSubmit) {
      onSlideComplete?.(upperChoice);
    }
  }, [disableCredit, disableDebit, onChange, onSlideComplete, playAudioClick]);

  // Dimension helpers
  const getBounds = () => {
    const track = trackRef.current;
    if (!track) return { trackWidth: 320, knobWidth: 52, maxTravel: 110, threshold: 55 };
    const trackWidth = track.clientWidth || 320;
    const knobWidth = 52;
    const padding = 5;
    const maxTravel = (trackWidth / 2) - (knobWidth / 2) - padding;
    const threshold = maxTravel * 0.58;
    return { trackWidth, knobWidth, maxTravel, threshold };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isSubmitting) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    currentOffsetRef.current = dragOffset;
    setIsDragging(true);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const { maxTravel, threshold } = getBounds();

    let newOffset = currentOffsetRef.current + deltaX;

    // Resistance if credit disabled
    if (disableCredit && newOffset < 0) {
      newOffset = Math.max(-10, newOffset * 0.15);
    }
    // Resistance if debit disabled
    if (disableDebit && newOffset > 0) {
      newOffset = Math.min(10, newOffset * 0.15);
    }

    // Clamp
    newOffset = Math.max(-maxTravel, Math.min(maxTravel, newOffset));
    setDragOffset(newOffset);

    // Threshold detection
    if (newOffset <= -threshold && !disableCredit) {
      if (reachedSide !== 'credit') {
        playAudioClick(780);
        try { navigator.vibrate?.(15); } catch (_) {}
        setReachedSide('credit');
      }
    } else if (newOffset >= threshold && !disableDebit) {
      if (reachedSide !== 'debit') {
        playAudioClick(520);
        try { navigator.vibrate?.(15); } catch (_) {}
        setReachedSide('debit');
      }
    } else {
      setReachedSide(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}

    const { threshold } = getBounds();

    if (dragOffset <= -threshold && !disableCredit) {
      // Slid fully to Credit!
      triggerChoice('credit', true);
    } else if (dragOffset >= threshold && !disableDebit) {
      // Slid fully to Debit!
      triggerChoice('debit', true);
    } else {
      // Did NOT slide fully to either side -> spring back to center
      playAudioClick(400);
      setDragOffset(0);
      setReachedSide(null);
      currentOffsetRef.current = 0;
    }
  };

  const handlePointerCancel = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    setDragOffset(0);
    setReachedSide(null);
    currentOffsetRef.current = 0;
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isSubmitting) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!disableCredit) triggerChoice('credit', true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!disableDebit) triggerChoice('debit', true);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const nextChoice = internalState === 'credit' ? 'debit' : 'credit';
      if (nextChoice === 'debit' && disableDebit) return;
      if (nextChoice === 'credit' && disableCredit) return;
      triggerChoice(nextChoice, true);
    }
  };

  return (
    <div className={`w-full flex flex-col items-center select-none ${className}`}>
      {/* CAPSULE TRACK */}
      <div
        ref={trackRef}
        data-state={internalState}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-[340px] sm:max-w-[380px] h-[58px] sm:h-[60px] rounded-full border-[1.5px] border-[#d4dce7] bg-[#fbfcfd] overflow-hidden cursor-pointer shadow-[0_12px_28px_-4px_rgba(185,198,218,0.5),0_3px_8px_rgba(0,0,0,0.03),inset_0_2px_2px_#ffffff,inset_0_-2.5px_3.5px_rgba(190,202,220,0.35)] touch-pan-y focus:outline-none focus:ring-2 focus:ring-blue-400/40 select-none"
      >
        {/* ACTIVE GLOSSY PILL INDICATOR */}
        <div
          aria-hidden="true"
          style={{
            left: internalState === 'credit' ? '5px' : 'calc(50% + 2px)',
            width: 'calc(50% - 7px)',
            background:
              internalState === 'credit'
                ? 'linear-gradient(180deg, #1cbd87 0%, #10ae76 10%, #0ba06c 22%, #068e5e 40%, #037e50 60%, #027c4f 75%, #028353 88%, #039d62 98%, #a0eed0 100%)'
                : 'linear-gradient(180deg, #ff3350 0%, #f21f3f 12%, #e01533 35%, #c40e27 65%, #b80b23 80%, #d91836 94%, #ff8597 100%)',
            boxShadow:
              internalState === 'credit'
                ? 'inset 0 2px 2.5px rgba(255, 255, 255, 0.75), inset 0 -2px 3px rgba(160, 240, 210, 0.5), 0 3px 12px rgba(1, 100, 60, 0.25)'
                : 'inset 0 2px 2.5px rgba(255, 255, 255, 0.75), inset 0 -2px 3px rgba(255, 170, 185, 0.5), 0 3px 12px rgba(190, 20, 45, 0.25)',
            transition: isDragging
              ? 'none'
              : 'left 0.45s cubic-bezier(0.34, 1.35, 0.64, 1), background 0.4s ease, box-shadow 0.4s ease'
          }}
          className="absolute top-[4px] bottom-[4px] rounded-full pointer-events-none z-1"
        >
          {/* Top glossy highlight reflection */}
          <div
            className="absolute top-[1px] left-[14px] right-[14px] h-[44%] rounded-full pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0.0) 100%)'
            }}
          />
        </div>

        {/* SOFT AMBIENT GLOW */}
        <div
          aria-hidden="true"
          style={{
            left: internalState === 'credit' ? '50%' : '10px',
            width: '45%',
            background:
              internalState === 'credit'
                ? 'radial-gradient(ellipse at 0% 50%, rgba(235, 25, 55, 0.12) 0%, rgba(235, 25, 55, 0.035) 45%, transparent 72%)'
                : 'radial-gradient(ellipse at 100% 50%, rgba(3, 139, 85, 0.14) 0%, rgba(3, 139, 85, 0.035) 45%, transparent 72%)',
            transition: 'left 0.45s ease, background 0.45s ease'
          }}
          className="absolute top-[4px] bottom-[4px] pointer-events-none z-1"
        />

        {/* CONTENT LAYER (CREDIT & DEBIT SEGMENTS) */}
        <div className="absolute inset-0 flex pointer-events-auto z-3">
          {/* Left: Credit */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!disableCredit) triggerChoice('credit', true);
            }}
            disabled={disabled || isSubmitting || disableCredit}
            className={`flex-1 h-full flex items-center justify-center gap-2 sm:gap-2.5 pl-3 pr-6 border-none bg-transparent transition-all outline-none ${
              disableCredit ? 'opacity-25 cursor-not-allowed pointer-events-none select-none' : 'cursor-pointer'
            }`}
            title={disableCredit ? 'Credit is not workable (Must debit invoice first)' : 'Credit'}
          >
            {/* Coin stack icon from reference */}
            <svg
              className={`w-[18px] h-[22px] shrink-0 transition-colors ${
                internalState === 'credit' ? 'text-white' : 'text-[#038b55]'
              }`}
              viewBox="0 0 41 54"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <ellipse
                cx="20.5"
                cy="10.5"
                rx="17.5"
                ry="6.5"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 10.5 v14 c0 3.8 7.8 6.5 17.5 6.5 s17.5 -2.7 17.5 -6.5 v-14"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <ellipse
                cx="20.5"
                cy="33.5"
                rx="17.5"
                ry="6.5"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 33.5 v14 c0 3.8 7.8 6.5 17.5 6.5 s17.5 -2.7 17.5 -6.5 v-14"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className={`text-[15px] sm:text-[16px] font-bold tracking-tight transition-colors ${
                internalState === 'credit' ? 'text-white' : 'text-[#038b55]'
              }`}
            >
              Credit
            </span>
          </button>

          {/* Right: Debit */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!disableDebit) triggerChoice('debit', true);
            }}
            disabled={disabled || isSubmitting || disableDebit}
            className={`flex-1 h-full flex items-center justify-center gap-2 sm:gap-2.5 pl-6 pr-3 border-none bg-transparent transition-all outline-none ${
              disableDebit ? 'opacity-25 cursor-not-allowed pointer-events-none select-none' : 'cursor-pointer'
            }`}
            title={disableDebit ? 'Debit is not workable (Already debited on this invoice)' : 'Debit'}
          >
            {/* Wallet icon from reference */}
            <svg
              className={`w-[20px] h-[20px] shrink-0 transition-colors ${
                internalState === 'debit' ? 'text-white' : 'text-[#eb1937]'
              }`}
              viewBox="0 0 50 51"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M3 15 C3 12, 7 3, 33 1.5 C40 1, 46 4, 47 10 L47 15"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="3"
                y="15"
                width="44"
                height="33"
                rx="6"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinejoin="round"
              />
              <line
                x1="3"
                y1="15"
                x2="47"
                y2="15"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path
                d="M47 27 H33 C30.5 27, 28.5 29, 28.5 31.5 C28.5 34, 30.5 36, 33 36 H47"
                fill="#fbfcfd"
                stroke="currentColor"
                strokeWidth="4.2"
                strokeLinejoin="round"
              />
              <circle cx="39.5" cy="31.5" r="2" fill="currentColor" />
            </svg>
            <span
              className={`text-[15px] sm:text-[16px] font-bold tracking-tight transition-colors ${
                internalState === 'debit' ? 'text-white' : 'text-[#eb1937]'
              }`}
            >
              Debit
            </span>
          </button>
        </div>

        {/* 3D TACTILE SLIDING KNOB */}
        <div
          ref={knobRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          style={{
            transform: `translate(calc(-50% + ${dragOffset}px), -50%)`,
            transition: isDragging
              ? 'none'
              : 'transform 0.45s cubic-bezier(0.34, 1.35, 0.64, 1), box-shadow 0.3s ease',
            touchAction: 'none'
          }}
          className={`absolute left-1/2 top-1/2 w-[50px] h-[50px] rounded-full flex items-center justify-center gap-1.5 z-10 select-none cursor-grab active:cursor-grabbing ${
            isDragging ? 'scale-105 shadow-[0_12px_28px_rgba(0,0,0,0.2),inset_0_3px_3px_#ffffff]' : ''
          }`}
        >
          {/* 3D tactile knob background & bevel */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #f7f9fb 100%)',
              boxShadow: isDragging
                ? '0 14px 30px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.12), inset 0 3px 3px #ffffff, inset 0 -3px 4px rgba(195,205,220,0.4), -5px 0 14px rgba(1,140,85,0.6), 6px 0 16px rgba(235,27,56,0.5)'
                : '0 8px 20px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08), inset 0 2.5px 2.5px rgba(255,255,255,1), inset 0 -2.5px 3.5px rgba(195,205,220,0.4), -4px 0 10px -1px rgba(1,140,85,0.45), 5px 0 12px -1px rgba(235,27,56,0.35)'
            }}
          />

          {/* Left chevron (Green #038b55) */}
          <div
            className={`relative z-1 flex items-center transition-transform ${
              disableCredit
                ? 'opacity-20'
                : reachedSide === 'credit'
                ? 'scale-125 drop-shadow-[0_0_6px_rgba(3,139,85,0.8)]'
                : dragOffset < -15
                ? 'scale-110'
                : ''
            }`}
          >
            <svg width="10" height="18" viewBox="0 0 19 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M15 4 L4 16 L15 28"
                stroke="#038b55"
                strokeWidth="4.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Right chevron (Red #eb1937) */}
          <div
            className={`relative z-1 flex items-center transition-transform ${
              disableDebit
                ? 'opacity-20'
                : reachedSide === 'debit'
                ? 'scale-125 drop-shadow-[0_0_6px_rgba(235,25,56,0.8)]'
                : dragOffset > 15
                ? 'scale-110'
                : ''
            }`}
          >
            <svg width="10" height="18" viewBox="0 0 19 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 4 L15 16 L4 28"
                stroke="#eb1937"
                strokeWidth="4.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SlideToChooseButton;
