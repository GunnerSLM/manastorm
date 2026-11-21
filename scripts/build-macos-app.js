#!/usr/bin/env node
/**
 * MANASTORM — Native macOS Application Bundle Builder
 * Packages the staged frontend and compiles the native WKWebView macOS shell
 * into dist-macos/MANASTORM.app (under 2MB total bundle size!).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { buildDist } = require("./build-dist");
const { generateAllIcons } = require("./generate-icons");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT_DIR, "dist-macos");
const APP_BUNDLE = path.join(OUT_DIR, "MANASTORM.app");
const CONTENTS_DIR = path.join(APP_BUNDLE, "Contents");
const MACOS_DIR = path.join(CONTENTS_DIR, "MacOS");
const RESOURCES_DIR = path.join(CONTENTS_DIR, "Resources");

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>MANASTORM</string>
  <key>CFBundleExecutable</key>
  <string>MANASTORM</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.manastorm.tcg</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>MANASTORM</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.card-games</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
</dict>
</plist>
`;

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildMacOsApp() {
  const icnsPath = path.join(ROOT_DIR, "icons", "icon.icns");
  if (!fs.existsSync(icnsPath)) {
    generateAllIcons();
  }

  const distDir = buildDist();

  fs.rmSync(APP_BUNDLE, { recursive: true, force: true });
  fs.mkdirSync(MACOS_DIR, { recursive: true });
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // 1. Write Info.plist & PkgInfo
  const plistPath = path.join(CONTENTS_DIR, "Info.plist");
  fs.writeFileSync(plistPath, INFO_PLIST, "utf8");
  fs.writeFileSync(path.join(CONTENTS_DIR, "PkgInfo"), "APPL????", "ascii");

  // Validate Info.plist syntax via plutil
  execFileSync("/usr/bin/plutil", ["-lint", plistPath], { stdio: "pipe" });

  // 2. Copy AppIcon.icns & staged dist assets into Resources
  fs.copyFileSync(icnsPath, path.join(RESOURCES_DIR, "AppIcon.icns"));
  copyDirRecursive(distDir, path.join(RESOURCES_DIR, "dist"));

  // 3. Compile native Objective-C Cocoa + WebKit executable
  const mainObjc = path.join(ROOT_DIR, "macos-native", "main.m");
  const binPath = path.join(MACOS_DIR, "MANASTORM");
  execFileSync(
    "/usr/bin/clang",
    [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Wno-unused-parameter",
      "-fobjc-arc",
      "-framework", "Cocoa",
      "-framework", "WebKit",
      mainObjc,
      "-o", binPath
    ],
    { stdio: "inherit" }
  );
  fs.chmodSync(binPath, 0o755);

  // 4. Ad-hoc codesign the .app bundle so Apple Silicon runs it cleanly
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", APP_BUNDLE],
    { stdio: "pipe" }
  );

  console.log(`✅ Built native macOS desktop app: ${APP_BUNDLE}`);
  return APP_BUNDLE;
}

if (require.main === module) {
  buildMacOsApp();
}

module.exports = { buildMacOsApp, APP_BUNDLE };
