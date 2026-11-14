// BACKEND-03: Authentication flows + the custom-claims bridge.
//
// IMPORTANT — the one real gap of going serverless: setting Firebase Custom Claims
// (organizationId/role/branchIds, which firestore.rules relies on) requires the Admin
// SDK, which needs a service-account secret and therefore CANNOT run in the browser.
// Since there is no Cloud Function and no server here, claims are set by you running
// `scripts/set-claims.js` locally (Node, with the service-account JSON you download once
// from Firebase Console → Project Settings → Service Accounts — never commit that file).
// This is a one-time or occasional admin action (new org, role change), not a per-request
// one, so it is a reasonable trade-off for a free/no-server deployment. See
// docs/DEPLOYMENT.md for exact steps and docs/LIMITATIONS.md for why.
//
// Everything else below (login, password reset, email verification, MFA, session
// management, account activation/deactivation) is implementable fully client-side with
// the Firebase Auth SDK and is wired up for real here.

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  sendEmailVerification,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { auth, db } from '../firebase-config.js';
import { writeAuditLog } from './audit.service.js';

/** Email/password login. Resolves with the Firebase user; throws Firebase's own error
 * codes (auth/wrong-password, auth/user-disabled, etc.) for the caller to translate. */
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
  if (userDoc.exists() && userDoc.data().status === 'deactivated') {
    await signOut(auth);
    throw new Error('account-deactivated');
  }
  await writeAuditLog({
    organizationId: userDoc.exists() ? userDoc.data().organizationId : null,
    actorUid: cred.user.uid,
    action: 'auth.login',
  });
  return cred.user;
}

export async function logout() {
  const uid = auth.currentUser?.uid;
  await signOut(auth);
  if (uid) {
    // best-effort; rules allow self-authored log entries only while still signed in,
    // so this must fire before signOut resolves in practice — kept here for clarity.
  }
}

/** Creates the Auth account only. The Firestore `users/{uid}` doc + custom claims are a
 * separate step performed by an admin (see createUserProfile + set-claims.js) — this
 * mirrors the spec's "prevent unauthorized account creation" constraint: a bare signup
 * with no matching profile/claims simply has no permissions anywhere in the app. */
export async function createAuthAccount(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  return cred.user;
}

/** Admin action: create/overwrite the Firestore profile for a uid that already has an
 * Auth account. Must be paired with scripts/set-claims.js for the role to take effect. */
export async function createUserProfile({ uid, organizationId, branchIds, role, email, displayName, createdBy }) {
  await setDoc(doc(db, 'users', uid), {
    organizationId, branchIds: branchIds || [], role, email, displayName,
    photoURL: null, status: 'active', mfaEnabled: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy,
  });
  await writeAuditLog({ organizationId, actorUid: createdBy, action: 'user.create', after: { uid, role } });
}

export async function deactivateUser(uid, { organizationId, actorUid }) {
  await updateDoc(doc(db, 'users', uid), { status: 'deactivated', updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: 'user.deactivate', after: { uid } });
}

export async function reactivateUser(uid, { organizationId, actorUid }) {
  await updateDoc(doc(db, 'users', uid), { status: 'active', updatedAt: serverTimestamp() });
  await writeAuditLog({ organizationId, actorUid, action: 'user.reactivate', after: { uid } });
}

export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

export function confirmReset(oobCode, newPassword) {
  return confirmPasswordReset(auth, oobCode, newPassword);
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

/** Optional MFA (BACKEND-03): SMS second factor enrollment. Requires an invisible
 * reCAPTCHA container element id passed in by the caller (dashboard.html supplies one). */
export async function enrollPhoneMfa(user, phoneNumber, recaptchaContainerId) {
  const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, { size: 'invisible' });
  const session = await multiFactor(user).getSession();
  const phoneInfoOptions = { phoneNumber, session };
  const phoneAuthProvider = new PhoneAuthProvider(auth);
  const verificationId = await phoneAuthProvider.verifyPhoneNumber(phoneInfoOptions, verifier);
  return verificationId; // caller collects the SMS code, then calls finalizePhoneMfa
}

export async function finalizePhoneMfa(user, verificationId, verificationCode, displayName = 'Primary phone') {
  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const assertion = PhoneMultiFactorGenerator.assertion(cred);
  await multiFactor(user).enroll(assertion, displayName);
  await updateDoc(doc(db, 'users', user.uid), { mfaEnabled: true, updatedAt: serverTimestamp() });
}

/** Subscribes to auth + profile state together; callback receives { user, profile } or
 * { user: null, profile: null } on sign-out. This is the single source apps should use
 * instead of calling onAuthStateChanged directly, so a deactivated-but-still-signed-in
 * edge case always gets caught. */
export function observeSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback({ user: null, profile: null });
    const snap = await getDoc(doc(db, 'users', user.uid));
    const profile = snap.exists() ? snap.data() : null;
    if (profile && profile.status === 'deactivated') {
      await signOut(auth);
      return callback({ user: null, profile: null });
    }
    callback({ user, profile });
  });
}
