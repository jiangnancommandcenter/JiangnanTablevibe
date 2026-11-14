// BACKEND-05: feedback submission, resolution, replies. submitFeedback is the one write
// path that must work for anonymous customers (no Firebase Auth account), so rules allow
// unauthenticated `create` as long as status/resolvedBy/createdAt are exactly right —
// enforced here client-side too so bad data never even leaves the browser.
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, query, where, orderBy, limit,
  startAfter, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { requireFields, assertEnum } from './firestore-helpers.js';
import { writeAuditLog, AUDIT_ACTIONS } from './audit.service.js';
import { getSurvey } from './surveys.service.js';

// Note: alerting on new/negative feedback is NOT triggered from here — an anonymous
// customer submitting feedback has no permission to write notifications or trigger email
// for staff, by design. Staff/branch_manager clients self-subscribe instead; see
// notifications.service.js `subscribeToBranchFeedbackAlerts` and its design note.

export async function submitFeedback({ organizationId, branchId, surveyId, employeeId = null, customerName = null, customerContact = null, answers, overallRating }) {
  requireFields({ organizationId, branchId, surveyId, overallRating }, ['organizationId', 'branchId', 'surveyId', 'overallRating']);
  if (!Array.isArray(answers) || answers.length === 0) throw new Error('Feedback must include at least one answer.');
  const survey = await getSurvey(surveyId);

  const ref = await addDoc(collection(db, 'feedback'), {
    organizationId, branchId, surveyId, surveyVersion: survey.version,
    employeeId, customerName, customerContact, answers, overallRating,
    status: 'new', resolvedBy: null, resolvedAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function resolveFeedback(feedbackId, { organizationId, branchId, actorUid }) {
  const ref = doc(db, 'feedback', feedbackId);
  await updateDoc(ref, { status: 'resolved', resolvedBy: actorUid, resolvedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, branchId, actorUid, action: AUDIT_ACTIONS.FEEDBACK_RESOLVE, after: { feedbackId } });
}

export async function setFeedbackStatus(feedbackId, status, { organizationId, branchId, actorUid }) {
  assertEnum(status, ['new', 'in_progress', 'resolved'], 'status');
  await updateDoc(doc(db, 'feedback', feedbackId), { status });
  await writeAuditLog({ organizationId, branchId, actorUid, action: 'feedback.status.update', after: { feedbackId, status } });
}

export async function replyToFeedback({ feedbackId, organizationId, branchId, authorUid, message }) {
  requireFields({ feedbackId, message }, ['feedbackId', 'message']);
  const ref = await addDoc(collection(db, 'feedback_replies'), {
    feedbackId, organizationId, branchId, authorUid, message, createdAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, branchId, actorUid: authorUid, action: 'feedback.reply', after: { feedbackId, replyId: ref.id } });
  return ref.id;
}

/** Cursor-based pagination (BACKEND-02 requirement), filterable by status/rating/branch. */
export async function listFeedback({ organizationId, branchId = null, status = null, pageSize = 25, cursor = null }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (branchId) constraints.push(where('branchId', '==', branchId));
  if (status) constraints.push(where('status', '==', status));
  constraints.push(orderBy('createdAt', 'desc'), limit(pageSize));
  if (cursor) constraints.push(startAfter(cursor instanceof Timestamp ? cursor : Timestamp.fromMillis(cursor)));
  const snap = await getDocs(query(collection(db, 'feedback'), ...constraints));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const nextCursor = items.length === pageSize ? items[items.length - 1].createdAt : null;
  return { items, nextCursor };
}

export async function getFeedback(feedbackId) {
  const snap = await getDoc(doc(db, 'feedback', feedbackId));
  if (!snap.exists()) throw new Error('Feedback not found.');
  return { id: snap.id, ...snap.data() };
}
