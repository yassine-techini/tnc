#!/usr/bin/env node
/**
 * Script to generate app assets (icon, splash screen, adaptive icon)
 *
 * Usage: node scripts/generate-assets.js
 *
 * Requires: sharp (npm install sharp)
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Installing sharp...');
  require('child_process').execSync('npm install sharp --save-dev', { stdio: 'inherit' });
  sharp = require('sharp');
}

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Colors
const GOLD = '#D4AF37';
const GOLD_DARK = '#B8960C';
const GOLD_LIGHT = '#E5C158';
const BACKGROUND = '#0F0F1A';

// Create SVG for app icon (gold coin with Au symbol)
function createIconSvg(size) {
  const center = size / 2;
  const outerRadius = size * 0.4;
  const innerRadius = size * 0.32;

  return `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${GOLD_LIGHT}"/>
      <stop offset="50%" style="stop-color:${GOLD}"/>
      <stop offset="100%" style="stop-color:${GOLD_DARK}"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="${GOLD}" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="${BACKGROUND}" rx="${size * 0.2}"/>

  <!-- Outer coin circle -->
  <circle cx="${center}" cy="${center}" r="${outerRadius}" fill="url(#goldGradient)" filter="url(#shadow)"/>

  <!-- Inner coin circle -->
  <circle cx="${center}" cy="${center}" r="${innerRadius}" fill="${GOLD_DARK}" stroke="${GOLD_LIGHT}" stroke-width="${size * 0.01}"/>

  <!-- Au symbol -->
  <text x="${center}" y="${center + size * 0.08}"
        font-family="Georgia, serif"
        font-size="${size * 0.25}"
        font-weight="900"
        font-style="italic"
        fill="${BACKGROUND}"
        text-anchor="middle">Au</text>
</svg>`;
}

// Create SVG for adaptive icon foreground (just the coin, no background)
function createAdaptiveIconSvg(size) {
  const center = size / 2;
  const outerRadius = size * 0.35;
  const innerRadius = size * 0.28;

  return `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${GOLD_LIGHT}"/>
      <stop offset="50%" style="stop-color:${GOLD}"/>
      <stop offset="100%" style="stop-color:${GOLD_DARK}"/>
    </linearGradient>
  </defs>

  <!-- Transparent background for adaptive icon -->
  <rect width="${size}" height="${size}" fill="transparent"/>

  <!-- Outer coin circle -->
  <circle cx="${center}" cy="${center}" r="${outerRadius}" fill="url(#goldGradient)"/>

  <!-- Inner coin circle -->
  <circle cx="${center}" cy="${center}" r="${innerRadius}" fill="${GOLD_DARK}" stroke="${GOLD_LIGHT}" stroke-width="${size * 0.01}"/>

  <!-- Au symbol -->
  <text x="${center}" y="${center + size * 0.07}"
        font-family="Georgia, serif"
        font-size="${size * 0.22}"
        font-weight="900"
        font-style="italic"
        fill="${BACKGROUND}"
        text-anchor="middle">Au</text>
</svg>`;
}

// Create SVG for splash screen
function createSplashSvg(width, height) {
  const centerX = width / 2;
  const centerY = height / 2 - 50;
  const coinRadius = Math.min(width, height) * 0.12;
  const innerRadius = coinRadius * 0.8;

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${GOLD_LIGHT}"/>
      <stop offset="50%" style="stop-color:${GOLD}"/>
      <stop offset="100%" style="stop-color:${GOLD_DARK}"/>
    </linearGradient>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="20" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="${BACKGROUND}"/>

  <!-- Subtle radial gradient overlay -->
  <radialGradient id="bgGradient" cx="50%" cy="40%">
    <stop offset="0%" style="stop-color:${GOLD};stop-opacity:0.05"/>
    <stop offset="100%" style="stop-color:${BACKGROUND};stop-opacity:0"/>
  </radialGradient>
  <rect width="${width}" height="${height}" fill="url(#bgGradient)"/>

  <!-- Gold coin -->
  <circle cx="${centerX}" cy="${centerY}" r="${coinRadius}" fill="url(#goldGradient)" filter="url(#glow)"/>
  <circle cx="${centerX}" cy="${centerY}" r="${innerRadius}" fill="${GOLD_DARK}" stroke="${GOLD_LIGHT}" stroke-width="3"/>

  <!-- Au symbol -->
  <text x="${centerX}" y="${centerY + coinRadius * 0.2}"
        font-family="Georgia, serif"
        font-size="${coinRadius * 0.7}"
        font-weight="900"
        font-style="italic"
        fill="${BACKGROUND}"
        text-anchor="middle">Au</text>

  <!-- App name -->
  <text x="${centerX}" y="${centerY + coinRadius * 1.8}"
        font-family="Arial, sans-serif"
        font-size="36"
        font-weight="700"
        fill="${GOLD}"
        text-anchor="middle"
        letter-spacing="4">TNC TRADING</text>

  <!-- Tagline -->
  <text x="${centerX}" y="${centerY + coinRadius * 2.3}"
        font-family="Arial, sans-serif"
        font-size="16"
        fill="#9CA3AF"
        text-anchor="middle"
        letter-spacing="2">Or souverain du Burkina Faso</text>
</svg>`;
}

// Create favicon SVG
function createFaviconSvg(size) {
  const center = size / 2;
  const radius = size * 0.4;

  return `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${BACKGROUND}"/>
  <circle cx="${center}" cy="${center}" r="${radius}" fill="${GOLD}"/>
  <text x="${center}" y="${center + size * 0.12}"
        font-family="Georgia, serif"
        font-size="${size * 0.35}"
        font-weight="900"
        fill="${BACKGROUND}"
        text-anchor="middle">Au</text>
</svg>`;
}

async function generateAssets() {
  console.log('Generating TNC Trading app assets...\n');

  // Ensure assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Generate icon.png (1024x1024)
  console.log('Generating icon.png (1024x1024)...');
  const iconSvg = createIconSvg(1024);
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('  icon.png created');

  // Generate adaptive-icon.png (1024x1024)
  console.log('Generating adaptive-icon.png (1024x1024)...');
  const adaptiveIconSvg = createAdaptiveIconSvg(1024);
  await sharp(Buffer.from(adaptiveIconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));
  console.log('  adaptive-icon.png created');

  // Generate splash.png (1284x2778 for iPhone 14 Pro Max)
  console.log('Generating splash.png (1284x2778)...');
  const splashSvg = createSplashSvg(1284, 2778);
  await sharp(Buffer.from(splashSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'splash.png'));
  console.log('  splash.png created');

  // Generate favicon.png (48x48)
  console.log('Generating favicon.png (48x48)...');
  const faviconSvg = createFaviconSvg(48);
  await sharp(Buffer.from(faviconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('  favicon.png created');

  console.log('\nAll assets generated successfully!');
  console.log(`Assets location: ${ASSETS_DIR}`);
}

generateAssets().catch(console.error);
