const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const inputLogo = path.join(__dirname, '../Gemini_Generated_Image_rh3f7erh3f7erh3f.png');
  const publicDir = path.join(__dirname, '../public');

  if (!fs.existsSync(inputLogo)) {
    console.error('New logo not found at:', inputLogo);
    process.exit(1);
  }

  // Also preserve a copy in public as app-icon.png
  fs.copyFileSync(inputLogo, path.join(publicDir, 'app-icon.png'));

  // 1. pwa-512x512.png (High-res crisp standard PWA icon)
  await sharp(inputLogo)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));
  console.log('Created pwa-512x512.png');

  // 2. pwa-192x192.png (Standard 192px PWA icon)
  await sharp(inputLogo)
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));
  console.log('Created pwa-192x192.png');

  // 3. pwa-maskable-512x512.png (Android adaptive maskable safe zone: 80% central area)
  const innerSize = Math.round(512 * 0.82); // 420px
  const innerBuffer = await sharp(inputLogo)
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
  .composite([
    {
      input: innerBuffer,
      gravity: 'center'
    }
  ])
  .png()
  .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
  console.log('Created pwa-maskable-512x512.png');

  // 4. apple-touch-icon.png (180x180 for iOS Safari)
  await sharp(inputLogo)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Created apple-touch-icon.png');

  // 5. favicon.png (64x64) and favicon-32x32.png
  await sharp(inputLogo)
    .resize(64, 64, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));
  
  await sharp(inputLogo)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'favicon-32x32.png'));

  // Also write favicon.ico from 48x48
  await sharp(inputLogo)
    .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));

  console.log('Created favicon.png, favicon-32x32.png, and favicon.ico');
  console.log('All PWA icons & favicons generated successfully from new logo!');
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
