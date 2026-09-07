const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const inputLogo = path.join(__dirname, '../public/logo.png');
  const publicDir = path.join(__dirname, '../public');

  if (!fs.existsSync(inputLogo)) {
    console.error('Logo not found at:', inputLogo);
    process.exit(1);
  }

  // 1. Get trimmed logo buffer
  const trimmedBuffer = await sharp(inputLogo)
    .trim({ threshold: 10 })
    .toBuffer();

  const trimmedMeta = await sharp(trimmedBuffer).metadata();
  console.log(`Trimmed logo bounds: ${trimmedMeta.width}x${trimmedMeta.height}`);

  // Helper to place trimmed logo inside a square canvas with padding & background
  async function createSquareIcon(size, innerRatio, bg = { r: 255, g: 255, b: 255, alpha: 1 }) {
    const targetInnerWidth = Math.round(size * innerRatio);
    const targetInnerHeight = Math.round(targetInnerWidth * (trimmedMeta.height / trimmedMeta.width));
    
    // Ensure height doesn't exceed innerRatio * size
    let finalW = targetInnerWidth;
    let finalH = targetInnerHeight;
    if (finalH > size * innerRatio) {
      finalH = Math.round(size * innerRatio);
      finalW = Math.round(finalH * (trimmedMeta.width / trimmedMeta.height));
    }

    const resizedLogo = await sharp(trimmedBuffer)
      .resize(finalW, finalH, { fit: 'contain' })
      .toBuffer();

    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: bg
      }
    })
    .composite([
      {
        input: resizedLogo,
        gravity: 'center'
      }
    ])
    .png()
    .toBuffer();
  }

  // 1. pwa-192x192.png (white rounded or clean white background)
  const icon192 = await createSquareIcon(192, 0.75, { r: 255, g: 255, b: 255, alpha: 1 });
  fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);
  console.log('Created pwa-192x192.png');

  // 2. pwa-512x512.png
  const icon512 = await createSquareIcon(512, 0.75, { r: 255, g: 255, b: 255, alpha: 1 });
  fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);
  console.log('Created pwa-512x512.png');

  // 3. pwa-maskable-512x512.png (Safe zone: central 80% circle, logo takes 65% with solid clean white or dark brand)
  const iconMaskable = await createSquareIcon(512, 0.62, { r: 255, g: 255, b: 255, alpha: 1 });
  fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), iconMaskable);
  console.log('Created pwa-maskable-512x512.png');

  // 4. apple-touch-icon.png (180x180)
  const appleIcon = await createSquareIcon(180, 0.75, { r: 255, g: 255, b: 255, alpha: 1 });
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon);
  console.log('Created apple-touch-icon.png');

  // 5. favicon.png & favicon-32x32.png
  const favicon = await createSquareIcon(64, 0.85, { r: 255, g: 255, b: 255, alpha: 1 });
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), favicon);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);
  console.log('Created favicon.png and favicon.ico');

  console.log('All PWA icons generated successfully!');
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
