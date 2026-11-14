#!/usr/bin/env node
/**
 * One-time/occasional admin utility (BACKEND-03): sets Firebase Auth Custom Claims for a
 * user. This is the ONLY place in the whole project that uses the Admin SDK / service
 * account, and it is meant to be run by you, locally, from a terminal — never deployed,
 * never shipped to the browser, never committed with real credentials attached.
 *
 * Setup (one-time):
 *   1. Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   2. Save it OUTSIDE this repo, e.g. ~/tablevibe-service-account.json
 *   3. npm install firebase-admin
 *
 * Usage:
 *   node set-claims.js --sa ~/tablevibe-service-account.json \
 *     --uid USER_UID --org ORG_ID --role admin --branches branchA,branchB
 */
const admin = require('firebase-admin');
const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    out[args[i].replace(/^--/, '')] = args[i + 1];
  }
  return out;
}

async function main() {
  const { sa, uid, org, role, branches } = parseArgs();
  if (!sa || !uid || !org || !role) {
    console.error('Usage: node set-claims.js --sa <path-to-service-account.json> --uid <uid> --org <orgId> --role <role> [--branches id1,id2]');
    process.exit(1);
  }
  const VALID_ROLES = ['super_admin', 'admin', 'branch_manager', 'staff', 'viewer'];
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(sa, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const branchIds = branches ? branches.split(',').filter(Boolean) : [];
  await admin.auth().setCustomUserClaims(uid, { orgId: org, role, branchIds });

  console.log(`Claims set for ${uid}: orgId=${org} role=${role} branchIds=${JSON.stringify(branchIds)}`);
  console.log('The user must sign out and back in (or call getIdToken(true)) for claims to take effect.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
