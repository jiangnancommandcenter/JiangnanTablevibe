// BACKEND-08: the 9 required reports, with date/branch/employee/rating filters, plus
// CSV/Excel/PDF export. Firestore's `count()` aggregation query (getCountFromServer) is
// used wherever a report only needs a number, which avoids full-document reads/billing
// for those parts even on the free tier. Reports that need full documents (e.g. rating
// distribution buckets) read a filtered, capped page of docs rather than a full scan —
// see docs/LIMITATIONS.md for when you'll want to add scheduled summary documents or
// BigQuery as data volume grows, exactly as the spec flags.
import {
  collection, query, where, orderBy, limit, getDocs, getCountFromServer, Timestamp,
  addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { writeAuditLog } from './audit.service.js';

const MAX_ROWS = 2000; // hard cap per report render, to keep this safe on Spark quotas

function dateFilters({ from, to }) {
  const out = [];
  if (from) out.push(where('createdAt', '>=', Timestamp.fromDate(new Date(from))));
  if (to) out.push(where('createdAt', '<=', Timestamp.fromDate(new Date(to))));
  return out;
}

function feedbackQuery({ organizationId, branchId, employeeId, status, minRating, maxRating, from, to }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (branchId) constraints.push(where('branchId', '==', branchId));
  if (employeeId) constraints.push(where('employeeId', '==', employeeId));
  if (status) constraints.push(where('status', '==', status));
  if (minRating != null) constraints.push(where('overallRating', '>=', minRating));
  if (maxRating != null) constraints.push(where('overallRating', '<=', maxRating));
  constraints.push(...dateFilters({ from, to }));
  constraints.push(orderBy('createdAt', 'desc'), limit(MAX_ROWS));
  return query(collection(db, 'feedback'), ...constraints);
}

// 1. Overall feedback
export async function reportOverallFeedback(filters) {
  const snap = await getDocs(feedbackQuery(filters));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const avg = rows.length ? rows.reduce((s, r) => s + r.overallRating, 0) / rows.length : 0;
  return { rows, summary: { count: rows.length, averageRating: round1(avg) } };
}

// 2. Branch performance
export async function reportBranchPerformance({ organizationId, branchIds, from, to }) {
  const results = [];
  for (const branchId of branchIds) {
    const snap = await getDocs(feedbackQuery({ organizationId, branchId, from, to }));
    const rows = snap.docs.map((d) => d.data());
    const avg = rows.length ? rows.reduce((s, r) => s + r.overallRating, 0) / rows.length : 0;
    const resolved = rows.filter((r) => r.status === 'resolved').length;
    results.push({ branchId, count: rows.length, averageRating: round1(avg), resolvedRate: rows.length ? round1((resolved / rows.length) * 100) : 0 });
  }
  return { rows: results };
}

// 3. Employee performance
export async function reportEmployeePerformance({ organizationId, employeeIds, from, to }) {
  const results = [];
  for (const employeeId of employeeIds) {
    const snap = await getDocs(feedbackQuery({ organizationId, employeeId, from, to }));
    const rows = snap.docs.map((d) => d.data());
    const avg = rows.length ? rows.reduce((s, r) => s + r.overallRating, 0) / rows.length : 0;
    results.push({ employeeId, count: rows.length, averageRating: round1(avg) });
  }
  return { rows: results };
}

// 4. Rating distribution
export async function reportRatingDistribution(filters) {
  const snap = await getDocs(feedbackQuery(filters));
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  snap.docs.forEach((d) => { const r = d.data().overallRating; if (dist[r] != null) dist[r] += 1; });
  return { rows: Object.entries(dist).map(([rating, count]) => ({ rating: Number(rating), count })) };
}

// 5. Positive and negative feedback (split by threshold, default >=4 positive, <=2 negative)
export async function reportPositiveNegative(filters, { positiveFrom = 4, negativeTo = 2 } = {}) {
  const [posSnap, negSnap] = await Promise.all([
    getDocs(feedbackQuery({ ...filters, minRating: positiveFrom })),
    getDocs(feedbackQuery({ ...filters, maxRating: negativeTo })),
  ]);
  return {
    positive: posSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    negative: negSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// 6. Unresolved and resolved feedback
export async function reportResolutionStatus(filters) {
  const orgRef = collection(db, 'feedback');
  const base = [where('organizationId', '==', filters.organizationId)];
  if (filters.branchId) base.push(where('branchId', '==', filters.branchId));
  const [unresolvedCount, resolvedCount] = await Promise.all([
    getCountFromServer(query(orgRef, ...base, where('status', 'in', ['new', 'in_progress']))),
    getCountFromServer(query(orgRef, ...base, where('status', '==', 'resolved'))),
  ]);
  return { unresolved: unresolvedCount.data().count, resolved: resolvedCount.data().count };
}

// 7. Survey responses
export async function reportSurveyResponses({ organizationId, surveyId, from, to }) {
  const constraints = [where('organizationId', '==', organizationId), where('surveyId', '==', surveyId)];
  constraints.push(...dateFilters({ from, to }), orderBy('createdAt', 'desc'), limit(MAX_ROWS));
  const snap = await getDocs(query(collection(db, 'feedback'), ...constraints));
  return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

// 8. Google reviews
export async function reportGoogleReviews({ organizationId, branchId, from, to }) {
  const constraints = [where('organizationId', '==', organizationId)];
  if (branchId) constraints.push(where('branchId', '==', branchId));
  constraints.push(orderBy('googleCreateTime', 'desc'), limit(MAX_ROWS));
  const snap = await getDocs(query(collection(db, 'google_reviews'), ...constraints));
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (from) rows = rows.filter((r) => r.googleCreateTime?.toMillis?.() >= new Date(from).getTime());
  if (to) rows = rows.filter((r) => r.googleCreateTime?.toMillis?.() <= new Date(to).getTime());
  return { rows };
}

// 9. Rewards usage
export async function reportRewardsUsage({ organizationId, rewardId, from, to }) {
  const base = [where('organizationId', '==', organizationId)];
  if (rewardId) base.push(where('rewardId', '==', rewardId));
  if (from) base.push(where('redeemedAt', '>=', Timestamp.fromDate(new Date(from))));
  if (to) base.push(where('redeemedAt', '<=', Timestamp.fromDate(new Date(to))));
  base.push(orderBy('redeemedAt', 'desc'), limit(MAX_ROWS));
  const snap = await getDocs(query(collection(db, 'reward_redemptions'), ...base));
  return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

function round1(n) { return Math.round(n * 10) / 10; }

// ---------- Export (BACKEND-08: PDF, Excel, CSV) ----------

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function toXlsxBlob(rows, sheetName = 'Report') {
  const XLSX = await import('https://esm.sh/xlsx@0.18.5');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function toPdfBlob(rows, title = 'Report') {
  const { jsPDF } = await import('https://esm.sh/jspdf@2.5.1');
  await import('https://esm.sh/jspdf-autotable@3.8.2');
  const docPdf = new jsPDF();
  docPdf.text(title, 14, 16);
  if (rows.length) {
    const headers = Object.keys(rows[0]);
    docPdf.autoTable({ startY: 22, head: [headers], body: rows.map((r) => headers.map((h) => String(r[h] ?? ''))) });
  }
  return docPdf.output('blob');
}

/** generateReport (Phase 5 endpoint) + exportFeedback: records what was generated for
 * the audit trail. The actual file is handed to the caller to download or, optionally,
 * uploaded to Cloudinary (reports folder) if you want a persistent link to share. */
export async function logReportGenerated({ organizationId, type, filters, format, actorUid, assetId = null }) {
  const ref = await addDoc(collection(db, 'reports'), {
    organizationId, type, filters, generatedBy: actorUid, format, assetId, createdAt: serverTimestamp(),
  });
  await writeAuditLog({ organizationId, actorUid, action: 'data.export', after: { reportId: ref.id, type, format } });
  return ref.id;
}
