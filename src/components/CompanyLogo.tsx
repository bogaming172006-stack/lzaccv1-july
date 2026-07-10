import React from 'react';

interface CompanyLogoProps {
  className?: string;
  variant?: 'color' | 'white' | 'dark';
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
  });
}

export default function CompanyLogo({ className = 'h-10', variant = 'color' }: CompanyLogoProps) {
  // If variant is 'white', we apply filters to invert the dark navy text of the logo to light/white
  // so that it stands out beautifully on dark backgrounds.
  const filterClass = variant === 'white' ? 'invert brightness-200' : '';

  return (
    <img 
      src="/logo.png" 
      alt="Greenzar Food & Beverage" 
      referrerPolicy="no-referrer"
      className={`object-contain max-h-full ${className} ${filterClass}`}
    />
  );
}

