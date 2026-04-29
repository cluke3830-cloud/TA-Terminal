const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Auto-detect iCloud Drive paths and redirect Next.js build output to a
// non-synced cache directory. iCloud aggressively syncs/evicts files
// inside `.next/server`, which makes the dev server fail with
// "Cannot find module .next/server/middleware-manifest.json".
// A clone outside iCloud uses the default `.next` directory.
function pickDistDir() {
  const cwd = process.cwd();
  const inICloud = cwd.includes('CloudDocs') || cwd.includes('Mobile Documents');
  if (!inICloud) return '.next';
  const hash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `next-${hash}`);
}

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  poweredByHeader: false,
  distDir: pickDistDir(),
};