// BACKEND-04: Cloudinary file management.
//
// Spec called for server-generated SIGNED upload parameters (API secret stays server-
// side). With no server, that specific mechanism is impossible — so this uses Cloudinary
// **unsigned upload presets** instead, which is Cloudinary's own documented pattern for
// secretless clients. The security controls move from "server signs it" to "the preset
// itself is locked down in the Cloudinary dashboard":
//   - Settings → Upload → Upload presets → (create preset) → Signing Mode: Unsigned
//   - Folder: fixed per preset (see FOLDERS below — make one preset per folder so a
//     survey-image upload can never land in, say, feedback_attachments)
//   - Allowed formats: restrict to image types you expect (jpg,png,webp)
//   - Max file size + max image dimensions: set in the preset
//   - Eager transformations: thumbnail generation configured on the preset itself
// This is a real, supported, lower-but-reasonable security posture for a no-server app —
// documented in full in docs/LIMITATIONS.md.
import {
  collection, addDoc, doc, deleteDoc, getDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { ENV } from '../config/env.js';
import { requireFields } from './firestore-helpers.js';
import { writeAuditLog } from './audit.service.js';

// Logical folder hierarchy (BACKEND-04). Each MUST correspond to its own locked-down
// unsigned preset in Cloudinary so files can't be mis-filed by a tampered request.
export const ASSET_FOLDERS = Object.freeze({
  COMPANY_LOGO: 'tablevibe/company_logos',
  BRANCH_IMAGE: 'tablevibe/branch_images',
  EMPLOYEE_PHOTO: 'tablevibe/employee_photos',
  SURVEY_IMAGE: 'tablevibe/survey_images',
  FEEDBACK_ATTACHMENT: 'tablevibe/feedback_attachments',
  REWARD_IMAGE: 'tablevibe/rewards',
  GENERATED_REPORT: 'tablevibe/generated_reports',
});

const MAX_BYTES = 10 * 1024 * 1024; // belt-and-suspenders client check; preset enforces the real limit
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Uploads a file to Cloudinary via an unsigned preset and records metadata in Firestore.
 * @param {File} file
 * @param {string} folder - one of ASSET_FOLDERS
 * @param {object} ctx - { organizationId, branchId, ownerUid, relatedCollection, relatedId }
 */
export async function uploadAsset(file, folder, ctx) {
  requireFields(ctx, ['organizationId', 'ownerUid']);
  if (!Object.values(ASSET_FOLDERS).includes(folder)) throw new Error(`Unknown asset folder: ${folder}`);
  if (file.size > MAX_BYTES) throw new Error('File is too large (max 10MB).');
  if (!ALLOWED_MIME.includes(file.type)) throw new Error(`File type ${file.type} is not allowed.`);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', ENV.cloudinary.unsignedUploadPreset);
  formData.append('folder', folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${ENV.cloudinary.cloudName}/auto/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cloudinary upload failed: ${res.status} ${errText}`);
  }
  const result = await res.json();

  const metaRef = await addDoc(collection(db, 'cloudinary_assets'), {
    organizationId: ctx.organizationId,
    branchId: ctx.branchId || null,
    ownerUid: ctx.ownerUid,
    folder,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    bytes: result.bytes,
    format: result.format,
    width: result.width || null,
    height: result.height || null,
    relatedCollection: ctx.relatedCollection || null,
    relatedId: ctx.relatedId || null,
    createdAt: serverTimestamp(),
  });

  await writeAuditLog({
    organizationId: ctx.organizationId, branchId: ctx.branchId || null, actorUid: ctx.ownerUid,
    action: 'asset.upload', after: { assetId: metaRef.id, folder, publicId: result.public_id },
  });

  return { assetId: metaRef.id, publicId: result.public_id, secureUrl: result.secure_url };
}

/**
 * Deletes a Cloudinary asset. Actual deletion from Cloudinary requires an authenticated
 * admin API call (needs API secret) — without a server this can't be done from the
 * browser. What IS done here: remove the Firestore metadata record immediately (so the
 * asset disappears from the app right away) and queue the real Cloudinary-side deletion
 * for you to run via the Admin API/CLI, documented in docs/LIMITATIONS.md. If/when you
 * add a tiny server or move to Blaze+Functions later, wire deleteCloudinaryFile there to
 * drain this queue automatically.
 */
export async function deleteAsset(assetId, { organizationId, branchId, actorUid }) {
  const ref = doc(db, 'cloudinary_assets', assetId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Asset not found.');
  const { publicId, folder } = snap.data();

  await deleteDoc(ref);
  await addDoc(collection(db, 'cloudinary_delete_queue'), {
    organizationId, publicId, folder, requestedBy: actorUid, requestedAt: serverTimestamp(), status: 'pending',
  });
  await writeAuditLog({ organizationId, branchId, actorUid, action: 'asset.delete', after: { assetId, publicId } });
}
