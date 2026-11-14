// BACKEND-05: QR code generation. Rendering the actual QR image is done entirely
// client-side with the `qrcode` npm package / CDN (no server needed to "generate" a QR —
// it's just an encoding of the target URL), while Firestore tracks the record + scan count.
import {
  collection, doc, addDoc, runTransaction, getDocs, query, where, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { requireFields } from './firestore-helpers.js';
import { writeAuditLog } from './audit.service.js';

const PUBLIC_FORM_BASE = 'https://YOUR_DOMAIN/feedback'; // update to your deployed URL

export async function generateQRCode({ organizationId, branchId, surveyId, label, actorUid }) {
  requireFields({ organizationId, branchId, surveyId, label }, ['organizationId', 'branchId', 'surveyId', 'label']);
  const ref = await addDoc(collection(db, 'qr_codes'), {
    organizationId, branchId, surveyId, label,
    targetUrl: null, // filled in right after we know the doc id, so the URL embeds it
    scanCount: 0, createdAt: serverTimestamp(),
  });
  const targetUrl = `${PUBLIC_FORM_BASE}/${ref.id}`;
  await runTransaction(db, async (tx) => {
    tx.update(doc(db, 'qr_codes', ref.id), { targetUrl });
  });
  await writeAuditLog({ organizationId, branchId, actorUid, action: 'qr.generate', after: { id: ref.id, label } });
  return { id: ref.id, targetUrl };
}

/** Called by the public feedback page (no auth) when a QR is scanned/opened.
 * Rules allow only a strict +1 increment on this field, nothing else. */
export async function recordQrScan(qrId) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'qr_codes', qrId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    tx.update(ref, { scanCount: increment(1) });
  });
}

export async function listQrCodes({ organizationId, branchId = null }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (branchId) constraints.push(where('branchId', '==', branchId));
  const snap = await getDocs(query(collection(db, 'qr_codes'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
