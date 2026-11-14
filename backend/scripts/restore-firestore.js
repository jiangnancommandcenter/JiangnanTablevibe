#!/usr/bin/env node
/**
 * BACKEND-10: restore runbook. Downloads a backup archive from Cloudinary and writes it
 * back into Firestore. ALWAYS run this against a staging/test Firebase project first —
 * never point --sa at production for a restore drill. See docs/DEPLOYMENT.md for how to
 * stand up a throwaway staging project (it's free on Spark too).
 *
 * Usage:
 *   node restore-firestore.js --sa ./staging-service-account.json \
 *     --backup-url "https://res.cloudinary.com/.../backup-2026-01-01.json.gz" \
 *     [--collections users,branches]   # omit to restore everything in the archive
 *     [--dry-run]
 */
const admin = require('firebase-admin');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { collections: null, 'dry-run': false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') { out['dry-run'] = true; continue; }
    if (args[i].startsWith('--')) { out[args[i].slice(2)] = args[i + 1]; i += 1; }
  }
  return out;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const a = parseArgs();
  if (!a.sa || !a['backup-url']) {
    console.error('Usage: node restore-firestore.js --sa <service-account.json> --backup-url <url> [--collections a,b] [--dry-run]');
    process.exit(1);
  }

  console.log(`Downloading backup from ${a['backup-url']}...`);
  const gz = await download(a['backup-url']);
  const json = zlib.gunzipSync(gz).toString('utf8');
  const dump = JSON.parse(json);

  const targetCollections = a.collections ? a.collections.split(',') : Object.keys(dump);
  console.log(`Will restore: ${targetCollections.join(', ')}`);
  console.log(`Dry run: ${a['dry-run'] ? 'YES (no writes will happen)' : 'no — this WILL overwrite documents'}`);

  if (!a['dry-run']) {
    const serviceAccount = JSON.parse(fs.readFileSync(a.sa, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    const db = admin.firestore();

    for (const name of targetCollections) {
      const docs = dump[name] || [];
      console.log(`Restoring ${name}: ${docs.length} docs...`);
      let batch = db.batch();
      let count = 0;
      for (const d of docs) {
        const { id, ...data } = d;
        batch.set(db.collection(name).doc(id), data);
        count += 1;
        if (count % 400 === 0) { await batch.commit(); batch = db.batch(); } // Firestore batch limit is 500
      }
      await batch.commit();
    }
    console.log('Restore complete. Now run a sanity pass: spot-check a few docs per collection and the firestore.rules deploy before pointing production traffic at this project.');
  } else {
    for (const name of targetCollections) {
      console.log(`  [dry-run] ${name}: would restore ${(dump[name] || []).length} docs`);
    }
  }
}

main().catch((err) => { console.error('RESTORE FAILED:', err); process.exit(1); });
