import React, { useEffect, useRef, useState } from 'react';

interface SplashLoaderProps {
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

export const SplashLoader: React.FC<SplashLoaderProps> = ({ className = '', style, onReady }) => {
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readyCalledRef = useRef(false);

  const handleReady = () => {
    if (!readyCalledRef.current) {
      readyCalledRef.current = true;
      if (onReady) {
        onReady();
      }
    }
  };

  // Safety fallback: if video hasn't loaded or played within 1.2s, proceed anyway
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      handleReady();
    }, 1200);

    return () => clearTimeout(safetyTimer);
  }, []);

  // Play video programmatically when element mounts
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        console.warn("Autoplay blocked or failed:", err);
        // If autoplay is blocked by the browser, proceed with loading
        handleReady();
      });
    }
  }, []);

  return (
    <div 
      className={`fixed inset-0 z-[9999] bg-white flex items-center justify-center overflow-hidden ${className}`}
      style={style}
    >
      <div className="relative w-full h-full flex flex-col items-center justify-center p-6 sm:p-12 md:p-16 gap-6">
        {!videoError ? (
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            webkit-playsinline="true"
            preload="auto"
            onPlay={handleReady}
            onPlaying={handleReady}
            onCanPlay={handleReady}
            onCanPlayThrough={handleReady}
            onError={() => {
              setVideoError(true);
              handleReady();
            }}
            className="w-full max-w-[180px] sm:max-w-[240px] md:max-w-[280px] lg:max-w-[320px] object-contain pointer-events-none select-none"
            style={{ pointerEvents: 'none' }}
          >
            <source src="/loading.webm" type="video/webm" />
            <source src="/loading.mp4" type="video/mp4" />
            {/* Fallback image if video elements are not supported */}
            <img 
              src="/logo.png" 
              alt="Greenzar Logo" 
              className="w-full max-w-[150px] sm:max-w-[180px] object-contain"
            />
          </video>
        ) : (
          /* Render static fallback logo if video error occurs */
          <img 
            src="/logo.png" 
            alt="Greenzar Logo" 
            className="w-full max-w-[150px] sm:max-w-[180px] object-contain animate-pulse"
          />
        )}
        {/* Elegant circular loading icon below the video */}
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin shadow-sm" />
      </div>
    </div>
  );
};

export default SplashLoader;
