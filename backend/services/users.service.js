// BACKEND-05 Phase 5 endpoints: updateUserRole, assignBranch. Creating the Auth account +
// Firestore profile lives in auth.service.js (createAuthAccount / createUserProfile)
// since that's inherently an auth concern; this file covers changes to an existing user.
//
// Reminder: changing `role` here updates the Firestore *display* doc only. The actual
// authorization change requires re-running scripts/set-claims.js with the new role —
// see docs/LIMITATIONS.md. The UI should tell the admin to do this in the same breath.
import {
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { assertEnum } from './firestore-helpers.js';
import { writeAuditLog, AUDIT_ACTIONS } from './audit.service.js';

const VALID_ROLES = ['super_admin', 'admin', 'branch_manager', 'staff', 'viewer'];

export async function updateUserRole(uid, newRole, { organizationId, actorUid }) {
  assertEnum(newRole, VALID_ROLES, 'role');
  const ref = doc(db, 'users', uid);
  const before = (await getDoc(ref)).data();
  await updateDoc(ref, { role: newRole, updatedAt: serverTimestamp() });
  await writeAuditLog({
    organizationId, actorUid, action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
    before: { role: before?.role }, after: { uid, role: newRole },
  });
  return { reminder: `Run: node scripts/set-claims.js --uid ${uid} --org ${organizationId} --role ${newRole} --branches <ids>` };
}

export async function assignBranch(uid, branchId, { organizationId, actorUid }) {
  const ref = doc(db, 'users', uid);
  await updateDoc(ref, { branchIds: arrayUnion(branchId), updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: 'user.branch.assign', after: { uid, branchId } });
  return { reminder: 'Re-run set-claims.js with the updated --branches list so rules pick up the new branch.' };
}

export async function unassignBranch(uid, branchId, { organizationId, actorUid }) {
  const ref = doc(db, 'users', uid);
  await updateDoc(ref, { branchIds: arrayRemove(branchId), updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: 'user.branch.unassign', after: { uid, branchId } });
}
