// BACKEND-02/05: survey management with immutable versioning. Editing a published survey
// never mutates it — it writes a new version doc and bumps `version`, so any feedback
// already answered against the old version keeps its exact original questions forever.
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { requireFields, assertEnum } from './firestore-helpers.js';
import { writeAuditLog, AUDIT_ACTIONS } from './audit.service.js';

export async function createSurvey({ organizationId, branchId = null, title, questions, actorUid }) {
  requireFields({ organizationId, title }, ['organizationId', 'title']);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('A survey needs at least one question.');
  }
  const ref = await addDoc(collection(db, 'surveys'), {
    organizationId, branchId, title, version: 1, questions, status: 'draft',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, branchId, actorUid, action: AUDIT_ACTIONS.SURVEY_CHANGE, after: { id: ref.id, title } });
  return ref.id;
}

export async function publishSurvey(surveyId, { organizationId, actorUid }) {
  await updateDoc(doc(db, 'surveys', surveyId), { status: 'published', updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: AUDIT_ACTIONS.SURVEY_CHANGE, after: { surveyId, status: 'published' } });
}

/** Creates version N+1 as a brand-new document; the old published version is archived,
 * never edited in place. Returns the new survey's id + version. */
export async function reviseSurvey(surveyId, { title, questions }, { organizationId, actorUid }) {
  const prevSnap = await getDoc(doc(db, 'surveys', surveyId));
  if (!prevSnap.exists()) throw new Error('Survey not found.');
  const prev = prevSnap.data();
  await updateDoc(doc(db, 'surveys', surveyId), { status: 'archived', updatedAt: serverTimestamp() });
  const ref = await addDoc(collection(db, 'surveys'), {
    organizationId: prev.organizationId, branchId: prev.branchId,
    title: title ?? prev.title, version: (prev.version || 1) + 1,
    questions: questions ?? prev.questions, status: 'draft',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, actorUid, action: AUDIT_ACTIONS.SURVEY_CHANGE, before: { surveyId }, after: { newSurveyId: ref.id } });
  return { id: ref.id, version: (prev.version || 1) + 1 };
}

export async function listSurveys({ organizationId, status = null }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (status) constraints.push(where('status', '==', status));
  const snap = await getDocs(query(collection(db, 'surveys'), ...constraints, orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSurvey(surveyId) {
  const snap = await getDoc(doc(db, 'surveys', surveyId));
  if (!snap.exists()) throw new Error('Survey not found.');
  return { id: snap.id, ...snap.data() };
}
