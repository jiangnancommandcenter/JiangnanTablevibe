// Shared helpers used by every CRUD service: input validation, idempotency, and a
// consistent error shape so the UI can show meaningful messages (BACKEND-05 engineering
// standards: strict validation, standardized error handling, idempotent operations).
import {
  doc, collection, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { db } from '../firebase-config.js';

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationError(`"${f}" is required`, f);
    }
  }
}

export function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(', ')}`, field);
  }
}

/**
 * Client-side idempotency: pass a stable idempotencyKey (e.g. a UUID the UI generates
 * once per user action/button-press and keeps around through retries) and this makes
 * sure a create is only ever applied once, by using the key as the document ID inside a
 * dedicated `*_idempotency` marker doc checked in the same transaction as the real write.
 */
export async function idempotentCreate(collectionName, idempotencyKey, buildDocFn) {
  const markerRef = doc(db, `${collectionName}_idempotency`, idempotencyKey);
  return runTransaction(db, async (tx) => {
    const marker = await tx.get(markerRef);
    if (marker.exists()) {
      return { id: marker.data().resultId, deduped: true };
    }
    const targetRef = doc(collection(db, collectionName));
    tx.set(targetRef, buildDocFn());
    tx.set(markerRef, { resultId: targetRef.id, createdAt: Date.now() });
    return { id: targetRef.id, deduped: false };
  });
}

export function toUserFacingError(err) {
  if (err instanceof ValidationError) return err.message;
  const code = err?.code || '';
  if (code === 'permission-denied') return "You don't have permission to do that.";
  if (code === 'not-found') return 'That record no longer exists.';
  if (code === 'already-exists') return 'That already exists.';
  return 'Something went wrong. Please try again.';
}
