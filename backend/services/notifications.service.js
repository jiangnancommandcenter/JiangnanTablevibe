// BACKEND-06: FCM push + in-app notification feed + feedback-event alerting.
//
// Design note on alerting without a server: an anonymous customer submitting feedback
// has no Firestore write permission to create notifications or trigger email for staff
// (and shouldn't — that's exactly the kind of elevated action a server would normally
// mediate). So alerting is NOT triggered from submitFeedback. Instead, each logged-in
// staff/manager client runs subscribeToBranchFeedbackAlerts after login, which listens
// for new 'new'-status feedback in their own branch and creates a notification + email
// FOR ITSELF ONLY (recipientUid always == the caller's own uid). That keeps every write
// self-authored (satisfies the rules cleanly) and avoids N staff members all fanning out
// duplicate alerts to each other. The real trade-off: a manager who is fully offline
// (app closed) gets no alert until they next open the app — there's no server to push to
// a closed client. See docs/LIMITATIONS.md.
import {
  collection, doc, addDoc, updateDoc, getDocs, getDoc, query, where, orderBy, limit,
  setDoc, onSnapshot, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js';
import { db, messaging } from '../firebase-config.js';
import { ENV } from '../config/env.js';
import { sendFeedbackAlertEmail, sendNegativeRatingAlertEmail } from './email.service.js';

/** Call once after login to register this browser for push, respecting per-user prefs. */
export async function registerForPush(uid) {
  if (!messaging) return null; // unsupported browser (e.g. Safari < 16, or no permission)
  const settingsSnap = await getDoc(doc(db, 'notification_settings', uid));
  if (settingsSnap.exists() && settingsSnap.data().pushAlerts === false) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const token = await getToken(messaging, { vapidKey: ENV.firebase.vapidKey });
  await setDoc(doc(db, 'users', uid), { fcmTokens: [token] }, { merge: true });
  return token;
}

export function onForegroundMessage(callback) {
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
}

/** sendNotification (Phase 5 endpoint). Rules require recipientUid or an elevated role —
 * in this serverless build, always call this with recipientUid == the caller's own uid
 * (see design note above), except for admin tools explicitly notifying a specific user. */
export async function sendNotification({ organizationId, branchId = null, recipientUid, type, title, body }) {
  const ref = await addDoc(collection(db, 'notifications'), {
    organizationId, branchId, recipientUid, type, title, body, read: false, createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listNotifications(uid, { unreadOnly = false, pageSize = 30 } = {}) {
  const constraints = [where('recipientUid', '==', uid)];
  if (unreadOnly) constraints.push(where('read', '==', false));
  constraints.push(orderBy('createdAt', 'desc'), limit(pageSize));
  const snap = await getDocs(query(collection(db, 'notifications'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function markNotificationRead(notificationId) {
  return updateDoc(doc(db, 'notifications', notificationId), { read: true });
}

export async function setNotificationPreferences(uid, { organizationId, emailAlerts, pushAlerts, negativeRatingThreshold }) {
  await setDoc(doc(db, 'notification_settings', uid), {
    organizationId, emailAlerts, pushAlerts, negativeRatingThreshold,
  }, { merge: true });
}

/**
 * Call once per session after a staff/branch_manager/admin logs in. Watches their own
 * branch(es) for newly-created feedback and self-alerts (in-app + email, per their own
 * notification_settings). Returns an unsubscribe function — call it on logout.
 * @param {object} p
 * @param {string} p.uid
 * @param {string} p.organizationId
 * @param {string} p.branchId
 * @param {string} p.email
 */
export function subscribeToBranchFeedbackAlerts({ uid, organizationId, branchId, email }) {
  const bootTime = Timestamp.now();
  const q = query(
    collection(db, 'feedback'),
    where('organizationId', '==', organizationId),
    where('branchId', '==', branchId),
    where('status', '==', 'new'),
    orderBy('createdAt', 'desc'),
    limit(20),
  );
  return onSnapshot(q, async (snap) => {
    const prefsSnap = await getDoc(doc(db, 'notification_settings', uid));
    const prefs = prefsSnap.exists() ? prefsSnap.data() : {};
    const threshold = prefs.negativeRatingThreshold ?? 2;

    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue;
      const fb = change.doc.data();
      if (!fb.createdAt || fb.createdAt.toMillis() < bootTime.toMillis()) continue; // ignore backlog on first load

      await sendNotification({
        organizationId, branchId, recipientUid: uid, type: 'feedback_alert',
        title: 'New feedback received', body: 'New customer feedback is waiting for review.',
      });
      if (prefs.emailAlerts !== false) {
        await sendFeedbackAlertEmail({ organizationId, to: email, branchName: branchId }).catch(() => {});
      }

      if (fb.overallRating <= threshold) {
        await sendNotification({
          organizationId, branchId, recipientUid: uid, type: 'negative_rating',
          title: 'Low rating alert', body: `A customer left a ${fb.overallRating}-star rating.`,
        });
        if (prefs.emailAlerts !== false) {
          await sendNegativeRatingAlertEmail({
            organizationId, to: email, branchName: branchId, rating: fb.overallRating, feedbackId: change.doc.id,
          }).catch(() => {});
        }
      }
    }
  });
}
