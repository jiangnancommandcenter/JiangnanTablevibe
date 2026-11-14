// BACKEND-06: transactional email, using EmailJS as the free, secretless substitute for
// Resend (Resend's API requires a server to hold its API key; EmailJS is specifically
// designed to send mail directly from the browser with a public key, rate-limited per
// domain in its own dashboard — see docs/LIMITATIONS.md for the trade-offs, notably: all
// recipients are visible in client code/network tab, so never put sensitive content
// customers shouldn't see in these templates, and EmailJS's free tier caps at 200
// emails/month).
import emailjs from 'https://esm.sh/@emailjs/browser@4';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { ENV } from '../config/env.js';

let initialized = false;
function ensureInit() {
  if (!initialized) {
    emailjs.init({ publicKey: ENV.emailjs.publicKey });
    initialized = true;
  }
}

async function send(templateId, to, templateParams, { organizationId }) {
  ensureInit();
  let status = 'sent';
  let error = null;
  try {
    await emailjs.send(ENV.emailjs.serviceId, templateId, { to_email: to, ...templateParams });
  } catch (err) {
    status = 'failed';
    error = err?.text || err?.message || String(err);
  }
  await addDoc(collection(db, 'email_logs'), {
    organizationId, to, template: templateId, provider: 'emailjs', status, error, createdAt: serverTimestamp(),
  });
  if (status === 'failed') throw new Error(`Email failed to send: ${error}`);
}

export function sendInvitationEmail({ organizationId, to, inviterName, orgName, loginUrl }) {
  return send(ENV.emailjs.templates.invitation, to, { inviter_name: inviterName, org_name: orgName, login_url: loginUrl }, { organizationId });
}

export function sendFeedbackAlertEmail({ organizationId, to, branchName, rating }) {
  return send(ENV.emailjs.templates.feedbackAlert, to, { branch_name: branchName, rating }, { organizationId });
}

export function sendNegativeRatingAlertEmail({ organizationId, to, branchName, rating, feedbackId }) {
  return send(ENV.emailjs.templates.negativeRating, to, { branch_name: branchName, rating, feedback_id: feedbackId }, { organizationId });
}

export function sendUnresolvedReminderEmail({ organizationId, to, count }) {
  return send(ENV.emailjs.templates.unresolvedReminder, to, { unresolved_count: count }, { organizationId });
}

export function sendReportReadyEmail({ organizationId, to, reportType, downloadUrl }) {
  return send(ENV.emailjs.templates.reportReady, to, { report_type: reportType, download_url: downloadUrl }, { organizationId });
}
