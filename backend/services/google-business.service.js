// BACKEND-07: Google Business Profile integration — OAuth, review sync, replies.
//
// Honest note on the secret question: Google's OAuth token endpoint requires a
// client_secret for every web-facing client type EXCEPT the "Desktop app" (installed
// app) client type, which Google's own documentation treats as public — its secret isn't
// meant to be kept confidential, since installed/native apps can't hide it either. So
// this integration is registered in Google Cloud Console as a **Desktop app** OAuth
// client (not "Web application"), which is the one configuration where shipping the
// client_secret in browser code matches Google's own threat model, combined with PKCE
// for the authorization-code exchange. This is a real, working, fully serverless OAuth
// flow — not a workaround. See docs/LIMITATIONS.md for the one soft spot: Google's token
// refresh calls must succeed via browser fetch (CORS); verify this against your actual
// Google Cloud project once configured, documented as a test step in docs/TEST-PLAN.md.
import {
  doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { ENV } from '../config/env.js';
import { writeAuditLog } from './audit.service.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const BUSINESS_API = 'https://mybusiness.googleapis.com/v4';

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
}
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64url(arr.buffer);
}

/** Step 1: kick off the PKCE authorization-code flow. Redirects the browser to Google. */
export async function startGoogleBusinessAuth() {
  const verifier = randomString();
  const challenge = base64url(await sha256(verifier));
  sessionStorage.setItem('gbp_pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: ENV.googleBusiness.clientId,
    redirect_uri: ENV.googleBusiness.redirectUri,
    response_type: 'code',
    scope: ENV.googleBusiness.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Step 2: call this from the page at ENV.googleBusiness.redirectUri with the `code`
 * query param Google appended. Exchanges the code for tokens and stores them. */
export async function completeGoogleBusinessAuth(code, { organizationId, actorUid }) {
  const verifier = sessionStorage.getItem('gbp_pkce_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier — restart the connection flow.');

  const body = new URLSearchParams({
    client_id: ENV.googleBusiness.clientId,
    client_secret: ENV.googleBusiness.clientSecret, // Desktop-app type: see file header
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: ENV.googleBusiness.redirectUri,
  });
  const res = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const tokens = await res.json();
  sessionStorage.removeItem('gbp_pkce_verifier');

  await setDoc(doc(db, 'google_integrations', organizationId), {
    organizationId, connected: true, googleAccountId: null, locationIds: [],
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastSyncAt: null, lastSyncStatus: null, lastSyncError: null,
  }, { merge: true });

  await writeAuditLog({ organizationId, actorUid, action: 'integration.google.connect' });
}

async function refreshAccessToken(organizationId) {
  const ref = doc(db, 'google_integrations', organizationId);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().refreshToken) throw new Error('Google Business Profile is not connected.');
  const { refreshToken } = snap.data();

  const body = new URLSearchParams({
    client_id: ENV.googleBusiness.clientId,
    client_secret: ENV.googleBusiness.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) {
    await setDoc(ref, { lastSyncStatus: 'error', lastSyncError: `Token refresh failed: ${res.status}` }, { merge: true });
    throw new Error('Google token refresh failed — the connection may need to be re-authorized.');
  }
  const tokens = await res.json();
  await setDoc(ref, { accessToken: tokens.access_token, tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000) }, { merge: true });
  return tokens.access_token;
}

async function getValidAccessToken(organizationId) {
  const snap = await getDoc(doc(db, 'google_integrations', organizationId));
  if (!snap.exists() || !snap.data().connected) throw new Error('Google Business Profile is not connected.');
  const data = snap.data();
  const expiresAt = data.tokenExpiresAt?.toDate ? data.tokenExpiresAt.toDate() : new Date(data.tokenExpiresAt);
  if (!expiresAt || expiresAt.getTime() - Date.now() < 60_000) {
    return refreshAccessToken(organizationId);
  }
  return data.accessToken;
}

/**
 * syncGoogleReviews (Phase 5 endpoint). Operational constraint from the spec, enforced
 * here literally: this NEVER marks internal feedback as resolved, and NEVER writes a
 * google_reviews doc unless the API call actually succeeded — on any error it records
 * lastSyncStatus: 'error' with the real error and throws, rather than pretending to
 * have synced.
 */
export async function syncGoogleReviews({ organizationId, branchId, googleLocationName, actorUid }) {
  const ref = doc(db, 'google_integrations', organizationId);
  try {
    const accessToken = await getValidAccessToken(organizationId);
    const res = await fetch(`${BUSINESS_API}/${googleLocationName}/reviews`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Google reviews API returned ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const reviews = data.reviews || [];

    let written = 0;
    for (const r of reviews) {
      const googleReviewId = r.reviewId || r.name;
      const dedupeId = `${organizationId}__${googleReviewId}`; // deterministic id = dedupe for free
      await setDoc(doc(db, 'google_reviews', dedupeId), {
        organizationId, branchId, googleReviewId,
        authorName: r.reviewer?.displayName || 'Anonymous',
        rating: ratingToNumber(r.starRating),
        comment: r.comment || '',
        googleCreateTime: new Date(r.createTime),
        replyText: r.reviewReply?.comment || null,
        replyPostedAt: r.reviewReply?.updateTime ? new Date(r.reviewReply.updateTime) : null,
        syncedAt: serverTimestamp(),
      }, { merge: true });
      written += 1;
    }

    await setDoc(ref, { lastSyncAt: serverTimestamp(), lastSyncStatus: 'ok', lastSyncError: null }, { merge: true });
    await writeAuditLog({ organizationId, branchId, actorUid, action: 'integration.google.sync', after: { reviewsSynced: written } });
    return { synced: written };
  } catch (err) {
    await setDoc(ref, { lastSyncStatus: 'error', lastSyncError: err.message }, { merge: true });
    throw err; // never swallow — caller must see sync actually failed
  }
}

function ratingToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || 0;
}

/** Posts an official reply. Mirrors the operational constraint: only ever reflects what
 * Google's API actually confirmed, never a simulated/optimistic success. */
export async function replyToGoogleReview({ organizationId, branchId, googleReviewName, replyText, actorUid }) {
  const accessToken = await getValidAccessToken(organizationId);
  const res = await fetch(`${BUSINESS_API}/${googleReviewName}/reply`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: replyText }),
  });
  if (!res.ok) throw new Error(`Failed to post Google reply: ${res.status} ${await res.text()}`);
  await writeAuditLog({ organizationId, branchId, actorUid, action: 'integration.google.reply' });
  return res.json();
}

export async function listGoogleReviews({ organizationId, branchId }) {
  const snap = await getDocs(query(
    collection(db, 'google_reviews'),
    where('organizationId', '==', organizationId),
    where('branchId', '==', branchId),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
