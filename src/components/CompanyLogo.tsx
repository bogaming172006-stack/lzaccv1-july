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

/**
 * Loads and downscales an image to an optimized size and data URL for fast, lightweight jsPDF embedding.
 * Prevents huge uncompressed 30MB+ bitmap embedding from high-res original assets.
 */
export async function getOptimizedLogoData(
  url = '/logo.png',
  maxDimension = 400,
  quality = 0.85
): Promise<{ dataUrl: string; width: number; height: number; format: 'JPEG' | 'PNG' }> {
  try {
    const img = await loadImage(url);
    const origWidth = img.naturalWidth || img.width || 100;
    const origHeight = img.naturalHeight || img.height || 100;
    
    // First canvas to inspect and crop empty top/bottom/side margins
    const trimCanvas = document.createElement('canvas');
    trimCanvas.width = origWidth;
    trimCanvas.height = origHeight;
    const trimCtx = trimCanvas.getContext('2d');
    
    let cropX = 0;
    let cropY = 0;
    let cropWidth = origWidth;
    let cropHeight = origHeight;

    if (trimCtx) {
      trimCtx.drawImage(img, 0, 0);
      const imgData = trimCtx.getImageData(0, 0, origWidth, origHeight);
      const { data } = imgData;
      
      let minX = origWidth, minY = origHeight, maxX = 0, maxY = 0;
      let found = false;

      for (let y = 0; y < origHeight; y++) {
        for (let x = 0; x < origWidth; x++) {
          const idx = (y * origWidth + x) * 4;
          const a = data[idx + 3];
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Pixel is considered visible content if it is not transparent and not pure white
          if (a > 20 && !(r > 248 && g > 248 && b > 248)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            found = true;
          }
        }
      }

      if (found && maxX > minX && maxY > minY) {
        cropX = minX;
        cropY = minY;
        cropWidth = maxX - minX + 1;
        cropHeight = maxY - minY + 1;
      }
    }

    let targetWidth = cropWidth;
    let targetHeight = cropHeight;
    
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      if (targetWidth >= targetHeight) {
        targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
        targetWidth = maxDimension;
      } else {
        targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
        targetHeight = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      return { dataUrl: img.src, width: origWidth, height: origHeight, format: 'PNG' };
    }

    // Draw white background for transparent PNG to avoid black boxes in JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      dataUrl,
      width: targetWidth,
      height: targetHeight,
      format: 'JPEG'
    };
  } catch (e) {
    throw e;
  }
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

