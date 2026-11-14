#!/usr/bin/env node
/**
 * BACKEND-10: automated Firestore backup. Runs with the Admin SDK (full read access,
 * bypasses security rules — this is the one place that's appropriate, since a backup by
 * definition needs everything). Dumps every collection in schema/SCHEMA.md to one JSON
 * file, gzips it, and uploads it to Cloudinary (tablevibe/generated_reports/backups/)
 * under a dated filename, using a SIGNED Cloudinary upload (we have a real secret here,
 * in a CI environment — unlike the browser, this is exactly where a secret belongs).
 *
 * Why Cloudinary instead of the GCS bucket the spec names: Firebase/GCS buckets require
 * the Blaze plan to provision in current GCP projects, which this build intentionally
 * avoids (see docs/LIMITATIONS.md). Cloudinary is already the project's file store and
 * has no such requirement — functionally equivalent "dedicated bucket with retention"
 * target for this build.
 *
 * Meant to run on a schedule via GitHub Actions (free) — see
 * .github/workflows/firestore-backup.yml — not locally day-to-day, though you can run it
 * by hand for an on-demand backup or a restore-drill dry run.
 *
 * Setup: npm install firebase-admin cloudinary
 * Usage:
 *   node backup-firestore.js --sa ./service-account.json \
 *     --cloud-name X --api-key Y --api-secret Z [--retention-days 30]
 */
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const COLLECTIONS = [
  'users', 'roles', 'permissions', 'organizations', 'branches', 'employees',
  'surveys', 'feedback', 'feedback_replies', 'feedback_categories', 'qr_codes',
  'google_integrations', 'google_reviews', 'rewards', 'reward_redemptions',
  'notifications', 'notification_settings', 'reports', 'activity_logs',
  'system_settings', 'email_logs', 'integrations', 'cloudinary_assets',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) out[args[i].replace(/^--/, '')] = args[i + 1];
  return out;
}

async function exportAll(db) {
  const dump = {};
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    dump[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`  ${name}: ${snap.size} docs`);
  }
  return dump;
}

async function main() {
  const a = parseArgs();
  if (!a.sa || !a['cloud-name'] || !a['api-key'] || !a['api-secret']) {
    console.error('Usage: node backup-firestore.js --sa <service-account.json> --cloud-name <name> --api-key <key> --api-secret <secret> [--retention-days 30]');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(a.sa, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  cloudinary.config({ cloud_name: a['cloud-name'], api_key: a['api-key'], api_secret: a['api-secret'] });

  console.log('Exporting collections...');
  const dump = await exportAll(db);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join('/tmp', `tablevibe-backup-${stamp}.json`);
  const gzPath = `${jsonPath}.gz`;
  fs.writeFileSync(jsonPath, JSON.stringify(dump));
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(jsonPath)));
  console.log(`Wrote ${gzPath} (${(fs.statSync(gzPath).size / 1024).toFixed(1)} KB)`);

  console.log('Uploading to Cloudinary...');
  const uploadResult = await cloudinary.uploader.upload(gzPath, {
    resource_type: 'raw',
    folder: 'tablevibe/generated_reports/backups',
    public_id: `backup-${stamp}`,
    use_filename: true,
  });
  console.log(`Uploaded: ${uploadResult.secure_url}`);

  // Verification: record the backup in Firestore so the dashboard can show backup
  // health (BACKEND-10 "automate backup completion verification").
  await db.collection('system_settings').doc('__backup_log__').collection('runs').add({
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    cloudinaryUrl: uploadResult.secure_url,
    bytes: uploadResult.bytes,
    collectionsBackedUp: COLLECTIONS,
    status: 'ok',
  });

  const retentionDays = Number(a['retention-days'] || 30);
  await applyRetention(retentionDays);

  fs.unlinkSync(jsonPath);
  fs.unlinkSync(gzPath);
  console.log('Backup complete.');
  process.exit(0);
}

/** Data Retention Constraint (BACKEND-10): only ever deletes OLD BACKUP ARCHIVES past
 * the retention window — never touches production records. */
async function applyRetention(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const result = await cloudinary.api.resources({
    type: 'upload', resource_type: 'raw', prefix: 'tablevibe/generated_reports/backups/', max_results: 500,
  });
  const stale = result.resources.filter((r) => new Date(r.created_at).getTime() < cutoff);
  for (const r of stale) {
    await cloudinary.uploader.destroy(r.public_id, { resource_type: 'raw' });
    console.log(`Removed expired backup: ${r.public_id}`);
  }
}

main().catch(async (err) => {
  console.error('BACKUP FAILED:', err);
  // Alert on failure (BACKEND-10): write a failure record even though the main try
  // didn't reach the success write — best-effort, wrapped so a double-failure doesn't mask the original error.
  try {
    const a = parseArgs();
    if (a.sa && admin.apps.length === 0) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(a.sa, 'utf8'))) });
    }
    if (admin.apps.length) {
      await admin.firestore().collection('system_settings').doc('__backup_log__').collection('runs').add({
        completedAt: admin.firestore.FieldValue.serverTimestamp(), status: 'error', error: String(err),
      });
    }
  } catch (_) { /* already failing, don't compound it */ }
  process.exit(1);
});
