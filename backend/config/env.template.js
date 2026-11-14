// Copy this file to env.js (gitignored) and fill in real values.
// NONE of these are secret in the traditional sense except where noted — Firebase web
// config and Cloudinary unsigned-preset/cloud-name are meant to ship in client code.
// Anything marked SECRET must never end up in this file or in any file committed/shipped
// to the browser — see docs/LIMITATIONS.md for how each secret-needing feature is handled.

export const ENV = {
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com', // unused (Cloudinary is the file store)
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    vapidKey: 'YOUR_FCM_WEB_PUSH_VAPID_KEY',
  },
  cloudinary: {
    cloudName: 'YOUR_CLOUDINARY_CLOUD_NAME',
    // Unsigned upload preset configured in the Cloudinary dashboard with:
    //   - folder restricted per asset type (see services/cloudinary.service.js)
    //   - allowed formats / max file size locked down there, NOT trusted client-side
    unsignedUploadPreset: 'YOUR_UNSIGNED_UPLOAD_PRESET',
  },
  emailjs: {
    // SECRET-ish: EmailJS public key is designed to ship client-side (rate-limited per
    // domain in their dashboard). Do NOT put an EmailJS *private* key here.
    serviceId: 'YOUR_EMAILJS_SERVICE_ID',
    publicKey: 'YOUR_EMAILJS_PUBLIC_KEY',
    templates: {
      invitation: 'YOUR_TEMPLATE_ID_INVITATION',
      feedbackAlert: 'YOUR_TEMPLATE_ID_FEEDBACK_ALERT',
      negativeRating: 'YOUR_TEMPLATE_ID_NEGATIVE_RATING',
      unresolvedReminder: 'YOUR_TEMPLATE_ID_UNRESOLVED_REMINDER',
      reportReady: 'YOUR_TEMPLATE_ID_REPORT_READY',
    },
  },
  googleBusiness: {
    // Create this as a "Desktop app" OAuth client in Google Cloud Console (NOT "Web
    // application") — Desktop-app clients are the one type Google's own docs treat as
    // public, so shipping clientSecret here matches Google's threat model when combined
    // with PKCE below. See services/google-business.service.js header comment.
    clientId: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
    clientSecret: 'YOUR_GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET',
    redirectUri: 'https://YOUR_DOMAIN/oauth/google-business/callback',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
  },
  sentry: {
    dsn: 'YOUR_SENTRY_DSN', // DSNs are meant to be public, this is fine client-side
  },
};
