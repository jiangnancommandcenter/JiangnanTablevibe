// BACKEND-01: Firebase app init, modular SDK, no build step required (served straight
// from the Google CDN so this drops into the existing static dashboard.html as-is).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getMessaging, isSupported as fcmSupported } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js';

import { ENV } from './config/env.js'; // create this from config/env.template.js

export const app = initializeApp(ENV.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);

export let messaging = null;
fcmSupported().then((ok) => {
  if (ok) messaging = getMessaging(app);
});

// Environment separation (BACKEND-01): point at the local emulator suite when running
// on localhost, so Development never touches Production data. Run:
//   firebase emulators:start --only auth,firestore
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
if (isLocalDev && window.__TABLEVIBE_USE_EMULATORS__ !== false) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // eslint-disable-next-line no-console
  console.info('[TableVibe] Connected to local Firebase emulators (dev mode).');
}
