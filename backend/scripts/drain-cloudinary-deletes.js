#!/usr/bin/env node
/**
 * Run this occasionally (weekly, or whenever you notice the queue growing) to actually
 * delete assets from Cloudinary that the app has already removed from Firestore.
 * This needs the Cloudinary API secret, which is why it can't run in the browser.
 *
 * Setup:
 *   npm install cloudinary firebase-admin
 *
 * Usage:
 *   node drain-cloudinary-deletes.js --sa ~/tablevibe-service-account.json \
 *     --cloud-name YOUR_CLOUD --api-key YOUR_KEY --api-secret YOUR_SECRET
 */
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) out[args[i].replace(/^--/, '')] = args[i + 1];
  return out;
}

async function main() {
  const a = parseArgs();
  if (!a.sa || !a['cloud-name'] || !a['api-key'] || !a['api-secret']) {
    console.error('Usage: node drain-cloudinary-deletes.js --sa <service-account.json> --cloud-name <name> --api-key <key> --api-secret <secret>');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(a.sa, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  cloudinary.config({ cloud_name: a['cloud-name'], api_key: a['api-key'], api_secret: a['api-secret'] });

  const snap = await db.collection('cloudinary_delete_queue').where('status', '==', 'pending').get();
  console.log(`Found ${snap.size} pending deletion(s).`);

  for (const docSnap of snap.docs) {
    const { publicId } = docSnap.data();
    try {
      await cloudinary.uploader.destroy(publicId);
      await docSnap.ref.update({ status: 'processed', processedAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`Deleted ${publicId}`);
    } catch (err) {
      console.error(`Failed to delete ${publicId}:`, err.message);
    }
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
