// BACKEND-10: client-side visibility into backup health. The actual export/upload runs
// in scripts/backup-firestore.js via the scheduled GitHub Action (Admin SDK access is
// required for a true full-tenant backup, which the browser never has). This service
// just reads the run log those scripts write, so an admin can see backup status/alerts
// in the dashboard without leaving the app.
import {
  collection, query, orderBy, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';

export async function listRecentBackups(pageSize = 10) {
  const snap = await getDocs(query(
    collection(db, 'system_settings/__backup_log__/runs'),
    orderBy('completedAt', 'desc'),
    limit(pageSize),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function lastBackupStatus() {
  const runs = await listRecentBackups(1);
  if (!runs.length) return { status: 'never_run' };
  return runs[0];
}
