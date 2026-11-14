// BACKEND-05: branch + employee management.
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { requireFields, assertEnum, toUserFacingError } from './firestore-helpers.js';
import { writeAuditLog, AUDIT_ACTIONS } from './audit.service.js';

export async function createBranch({ organizationId, name, address, googlePlaceId = null, managerUid = null, actorUid }) {
  requireFields({ organizationId, name, address }, ['organizationId', 'name', 'address']);
  const ref = await addDoc(collection(db, 'branches'), {
    organizationId, name, address, googlePlaceId, managerUid, status: 'active',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, actorUid, action: AUDIT_ACTIONS.BRANCH_CHANGE, after: { id: ref.id, name } });
  return ref.id;
}

export async function updateBranch(branchId, patch, { organizationId, actorUid }) {
  const ref = doc(db, 'branches', branchId);
  const before = (await getDoc(ref)).data();
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: AUDIT_ACTIONS.BRANCH_CHANGE, before, after: patch });
}

export async function listBranches(organizationId) {
  const snap = await getDocs(query(collection(db, 'branches'), where('organizationId', '==', organizationId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createEmployee({ organizationId, branchId, name, position, uid = null, actorUid }) {
  requireFields({ organizationId, branchId, name, position }, ['organizationId', 'branchId', 'name', 'position']);
  try {
    const ref = await addDoc(collection(db, 'employees'), {
      organizationId, branchId, uid, name, position, photoAssetId: null,
      status: 'active', createdAt: serverTimestamp(),
    });
    await writeAuditLog({ organizationId, branchId, actorUid, action: 'employee.create', after: { id: ref.id, name } });
    return ref.id;
  } catch (err) {
    throw new Error(toUserFacingError(err));
  }
}

export async function listEmployees({ organizationId, branchId }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (branchId) constraints.push(where('branchId', '==', branchId));
  const snap = await getDocs(query(collection(db, 'employees'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function setEmployeeStatus(employeeId, status, { organizationId, branchId, actorUid }) {
  assertEnum(status, ['active', 'inactive'], 'status');
  await updateDoc(doc(db, 'employees', employeeId), { status });
  await writeAuditLog({ organizationId, branchId, actorUid, action: 'employee.status.update', after: { employeeId, status } });
}
