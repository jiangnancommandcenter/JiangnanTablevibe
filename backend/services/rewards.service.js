// BACKEND-05: reward management + redemption with duplicate-prevention via transaction.
import {
  collection, doc, addDoc, getDocs, query, where, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { requireFields } from './firestore-helpers.js';
import { writeAuditLog } from './audit.service.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // one redemption per reward per customer per day

export async function createReward({ organizationId, title, description, pointsCost = null, code, actorUid }) {
  requireFields({ organizationId, title, code }, ['organizationId', 'title', 'code']);
  const ref = await addDoc(collection(db, 'rewards'), {
    organizationId, title, description, pointsCost, code, status: 'active', createdAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, actorUid, action: 'reward.create', after: { id: ref.id, title } });
  return ref.id;
}

export async function listRewards(organizationId) {
  const snap = await getDocs(query(collection(db, 'rewards'), where('organizationId', '==', organizationId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** redeemReward (Phase 5 endpoint): prevents duplicate redemption with a genuinely atomic
 * check — Firestore transactions can only guarantee consistency on documents read by
 * direct reference, not on queries, so instead of "query then write" (which has a race
 * window between two concurrent scans) this uses a deterministic document ID derived
 * from rewardId + customerContact + cooldown-window bucket. The transaction reads that
 * exact doc by reference and only writes if it doesn't exist yet, which Firestore
 * guarantees is race-free even under concurrent calls. */
export async function redeemReward({ rewardId, organizationId, branchId, customerContact, redeemedBy }) {
  requireFields({ rewardId, customerContact, redeemedBy }, ['rewardId', 'customerContact', 'redeemedBy']);

  const bucket = Math.floor(Date.now() / COOLDOWN_MS);
  const dedupeId = `${rewardId}__${encodeURIComponent(customerContact)}__${bucket}`;
  const ref = doc(db, 'reward_redemptions', dedupeId);

  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      throw new Error('This reward was already redeemed by this customer in the last 24 hours.');
    }
    tx.set(ref, {
      organizationId, branchId, rewardId, customerContact, redeemedBy, redeemedAt: serverTimestamp(),
    });
    return ref.id;
  });
}
