// BACKEND-09: immutable audit trail. Writes are append-only by rule (no update/delete
// allowed on activity_logs for anyone, including admins) and createdAt must equal
// request.time, so clients cannot backdate or forge timestamps.
import {
  collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';

/**
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} [p.branchId]
 * @param {string} p.actorUid
 * @param {string} p.action - e.g. 'user.create', 'feedback.resolve', 'report.export'
 * @param {object} [p.before]
 * @param {object} [p.after]
 */
export async function writeAuditLog({ organizationId, branchId = null, actorUid, action, before = null, after = null }) {
  if (!organizationId || !actorUid || !action) {
    // Never throw from logging — but never silently pretend it worked either.
    console.warn('[audit] skipped incomplete audit log', { organizationId, actorUid, action });
    return null;
  }
  return addDoc(collection(db, 'activity_logs'), {
    organizationId, branchId, actorUid, action, before, after,
    createdAt: serverTimestamp(),
  });
}

export async function listAuditLogs({ organizationId, actorUid = null, pageSize = 50 }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (actorUid) constraints.push(where('actorUid', '==', actorUid));
  const q = query(collection(db, 'activity_logs'), ...constraints, orderBy('createdAt', 'desc'), limit(pageSize));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Mandatory audit events per spec — call writeAuditLog with these exact action strings
// from the relevant service so activity_logs stays a complete, greppable trail:
export const AUDIT_ACTIONS = Object.freeze({
  LOGIN: 'auth.login',
  USER_CREATE: 'user.create',
  USER_ROLE_CHANGE: 'user.role.update',
  USER_DEACTIVATE: 'user.deactivate',
  PERMISSION_CHANGE: 'permission.update',
  BRANCH_CHANGE: 'branch.update',
  SURVEY_CHANGE: 'survey.update',
  FEEDBACK_RESOLVE: 'feedback.resolve',
  DATA_EXPORT: 'data.export',
  INTEGRATION_CHANGE: 'integration.update',
  SYSTEM_CONFIG_CHANGE: 'system.settings.update',
});
