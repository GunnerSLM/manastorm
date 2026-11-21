#!/usr/bin/env node
/**
 * MANASTORM — Desktop Icon Generator
 * Generates bespoke high-craft PNG icons (32x32, 128x128, 128x128@2x, 1024x1024),
 * a multi-resolution Windows .ico file, and a native macOS .icns bundle via iconutil.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT_DIR, "icons");

// --- CRC32 Table for PNG Chunks ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaToPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const rawData = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawData[rowStart] = 0; // filter type 0 (None)
    rgba.copy(rawData, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", compressed),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Renders the MANASTORM icon at the specified resolution:
 * - macOS-style superellipse squircle in deep obsidian/arcane violet
 * - Golden metallic inner bezel
 * - Five MTG mana orbs (White, Blue, Black, Red, Green) in a pentagon
 * - Glowing central Arcane Star / Planeswalker resonance emblem
 */
function renderManastormIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const invSize = 1 / size;

  // Pentagon mana pip positions & RGB colors (W, U, B, R, G)
  const pips = [
    { angle: -Math.PI / 2, r: 255, g: 242, b: 184 },                   // White (Gold-Ivory top)
    { angle: -Math.PI / 2 + (2 * Math.PI) / 5, r: 68, g: 182, b: 255 }, // Blue (top-right)
    { angle: -Math.PI / 2 + (4 * Math.PI) / 5, r: 179, g: 112, b: 255 },// Black/Arcane (bottom-right)
    { angle: -Math.PI / 2 + (6 * Math.PI) / 5, r: 255, g: 88, b: 76 },  // Red (bottom-left)
    { angle: -Math.PI / 2 + (8 * Math.PI) / 5, r: 66, g: 219, b: 132 }  // Green (top-left)
  ].map(p => ({
    ...p,
    x: 0.5 + Math.cos(p.angle) * 0.285,
    y: 0.5 + Math.sin(p.angle) * 0.285
  }));

  const aa = 1.5 / size;

  for (let py = 0; py < size; py++) {
    const ny = (py + 0.5) * invSize;
    const cy = ny - 0.5;

    for (let px = 0; px < size; px++) {
      const nx = (px + 0.5) * invSize;
      const cx = nx - 0.5;

      // Superellipse squircle distance (radius ~ 0.445)
      const ax = Math.abs(cx) / 0.445;
      const ay = Math.abs(cy) / 0.445;
      const squircleDist = Math.pow(Math.pow(ax, 4.4) + Math.pow(ay, 4.4), 1 / 4.4);

      const outerAlpha = 1 - smoothstep(1.0 - aa * 2.5, 1.0 + aa * 2.5, squircleDist);
      if (outerAlpha <= 0) continue;

      const rad = Math.hypot(cx, cy);
      const angle = Math.atan2(cy, cx);

      // Base dark obsidian-indigo radial gradient
      const bgGrad = clamp01(1 - rad * 1.65);
      let r = mix(11, 28, bgGrad);
      let g = mix(13, 24, bgGrad);
      let b = mix(22, 48, bgGrad);

      // Subtle diagonal foil sheen
      const sheen = Math.pow(clamp01(1 - Math.abs((nx - ny) - 0.08) * 2.4), 3);
      r += sheen * 22;
      g += sheen * 16;
      b += sheen * 36;

      // Golden metallic outer border ring (squircleDist 0.90 .. 0.97)
      const borderBand =
        smoothstep(0.89 - aa, 0.91 + aa, squircleDist) *
        (1 - smoothstep(0.96 - aa, 0.985 + aa, squircleDist));
      if (borderBand > 0) {
        const goldLight = 0.65 + 0.35 * Math.cos(angle * 2 + 0.8);
        r = mix(r, 246 * goldLight, borderBand * 0.88);
        g = mix(g, 194 * goldLight, borderBand * 0.88);
        b = mix(b, 92 * goldLight, borderBand * 0.88);
      }

      // Arcane inner circle ring at radius 0.285 (connecting the 5 mana pips)
      const ringDist = Math.abs(rad - 0.285);
      const ringGlow = 1 - smoothstep(0.004, 0.022 + aa, ringDist);
      if (ringGlow > 0) {
        r += ringGlow * 75;
        g += ringGlow * 55;
        b += ringGlow * 120;
      }

      // Central 8-point Planeswalker / Resonance Starburst
      const star4A = Math.pow(Math.abs(Math.cos(angle * 2)), 6);
      const star4B = Math.pow(Math.abs(Math.sin(angle * 2)), 10) * 0.72;
      const starReach = 0.075 + 0.145 * Math.max(star4A, star4B);
      const starMask = 1 - smoothstep(starReach - 0.02 - aa, starReach + 0.015 + aa, rad);
      const coreGlow = Math.exp(-rad * rad * 36);

      if (coreGlow > 0.01) {
        r += coreGlow * 95;
        g += coreGlow * 68;
        b += coreGlow * 28;
      }

      if (starMask > 0) {
        const innerCore = 1 - smoothstep(0.0, 0.09, rad);
        const sr = mix(255, 255, innerCore);
        const sg = mix(198, 248, innerCore);
        const sb = mix(72, 215, innerCore);
        r = mix(r, sr, starMask);
        g = mix(g, sg, starMask);
        b = mix(b, sb, starMask);
      }

      // Five Mana Color Orbs
      for (let i = 0; i < pips.length; i++) {
        const pip = pips[i];
        const pd = Math.hypot(nx - pip.x, ny - pip.y);
        const pipGlow = Math.exp(-pd * pd * 420);
        if (pipGlow > 0.01) {
          r += pip.r * pipGlow * 0.42;
          g += pip.g * pipGlow * 0.42;
          b += pip.b * pipGlow * 0.42;
        }
        const pipBody = 1 - smoothstep(0.044 - aa, 0.048 + aa, pd);
        if (pipBody > 0) {
          const highlight = clamp01(1 - Math.hypot((nx - pip.x) + 0.014, (ny - pip.y) + 0.014) * 22);
          const pr = mix(pip.r, 255, highlight * 0.55);
          const pg = mix(pip.g, 255, highlight * 0.55);
          const pb = mix(pip.b, 255, highlight * 0.55);
          r = mix(r, pr, pipBody);
          g = mix(g, pg, pipBody);
          b = mix(b, pb, pipBody);
        }
      }

      const idx = (py * size + px) * 4;
      rgba[idx] = Math.min(255, Math.max(0, Math.round(r)));
      rgba[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      rgba[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      rgba[idx + 3] = Math.min(255, Math.max(0, Math.round(outerAlpha * 255)));
    }
  }

  return encodeRgbaToPng(size, size, rgba);
}

/**
 * Packs multiple PNG buffers into a standard Windows .ico file
 */
function buildIcoFromPngs(entries) {
  const count = entries.length;
  const headerSize = 6 + count * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type 1 = ICO
  header.writeUInt16LE(count, 4); // Number of images

  let offset = headerSize;
  const dataBuffers = [];

  entries.forEach((entry, idx) => {
    const dirOffset = 6 + idx * 16;
    header[dirOffset] = entry.size >= 256 ? 0 : entry.size;
    header[dirOffset + 1] = entry.size >= 256 ? 0 : entry.size;
    header[dirOffset + 2] = 0; // Color palette
    header[dirOffset + 3] = 0; // Reserved
    header.writeUInt16LE(1, dirOffset + 4);  // Color planes
    header.writeUInt16LE(32, dirOffset + 6); // Bits per pixel
    header.writeUInt32LE(entry.png.length, dirOffset + 8);
    header.writeUInt32LE(offset, dirOffset + 12);
    offset += entry.png.length;
    dataBuffers.push(entry.png);
  });

  return Buffer.concat([header, ...dataBuffers]);
}

function generateAllIcons() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const sizesNeeded = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngBySize = {};
  for (const sz of sizesNeeded) {
    pngBySize[sz] = renderManastormIcon(sz);
  }

  // Write standard Tauri PNG icons
  fs.writeFileSync(path.join(ICONS_DIR, "32x32.png"), pngBySize[32]);
  fs.writeFileSync(path.join(ICONS_DIR, "128x128.png"), pngBySize[128]);
  fs.writeFileSync(path.join(ICONS_DIR, "128x128@2x.png"), pngBySize[256]);
  fs.writeFileSync(path.join(ICONS_DIR, "icon.png"), pngBySize[1024]);

  // Write Windows .ico
  const icoBuffer = buildIcoFromPngs([
    { size: 16, png: pngBySize[16] },
    { size: 32, png: pngBySize[32] },
    { size: 48, png: pngBySize[48] },
    { size: 256, png: pngBySize[256] }
  ]);
  fs.writeFileSync(path.join(ICONS_DIR, "icon.ico"), icoBuffer);

  // Build macOS .icns via /usr/bin/iconutil (with pure-node ICNS fallback for non-macOS)
  const iconsetDir = path.join(ICONS_DIR, "icon.iconset");
  fs.mkdirSync(iconsetDir, { recursive: true });

  const iconsetMap = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024]
  ];

  for (const [filename, sz] of iconsetMap) {
    fs.writeFileSync(path.join(iconsetDir, filename), pngBySize[sz]);
  }

  const icnsPath = path.join(ICONS_DIR, "icon.icns");
  try {
    execFileSync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], {
      stdio: "pipe"
    });
  } catch (_) {
    // Fallback: construct valid ICNS container with ic07 (128), ic08 (256), ic09 (512), ic10 (1024) PNG chunks
    const icnsTypes = [
      ["ic07", pngBySize[128]],
      ["ic08", pngBySize[256]],
      ["ic09", pngBySize[512]],
      ["ic10", pngBySize[1024]]
    ];
    const chunks = icnsTypes.map(([ostype, buf]) => {
      const hdr = Buffer.alloc(8);
      hdr.write(ostype, 0, 4, "ascii");
      hdr.writeUInt32BE(buf.length + 8, 4);
      return Buffer.concat([hdr, buf]);
    });
    const totalLen = 8 + chunks.reduce((s, c) => s + c.length, 0);
    const fileHdr = Buffer.alloc(8);
    fileHdr.write("icns", 0, 4, "ascii");
    fileHdr.writeUInt32BE(totalLen, 4);
    fs.writeFileSync(icnsPath, Buffer.concat([fileHdr, ...chunks]));
  } finally {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }

  console.log("✅ Generated MANASTORM desktop icons in icons/");
}

if (require.main === module) {
  generateAllIcons();
}

module.exports = { generateAllIcons, renderManastormIcon };
