// ---- reCAPTCHA site keys (create them at https://www.google.com/recaptcha/admin) ----
// v2 "I'm not a robot" Checkbox key: shown on the dashboard login.
const RECAPTCHA_V2_SITE_KEY = "6LfbwSIuAAAAADmtj2C28Asy0_S3eN9sAMobIFH-";
// App Check key: a Google Cloud "Fraud Defense" (reCAPTCHA Enterprise) website key, used invisibly
// by Firebase App Check on every page. Create it in Google Cloud Console (project tablevibe-5cd4e)
// → Security → Fraud Defense / reCAPTCHA. It has no secret key: just register its ID in Firebase App Check.
const RECAPTCHA_V3_SITE_KEY = "6LfPvCIuAAAAAGkXH_quu24Qccq5GxTZuCZQaaGz";

// ---- EmailJS (emails the 5% voucher code after the survey) — https://www.emailjs.com ----
// Leave any of these empty to switch the voucher off (the email box is then hidden).
const EMAILJS_PUBLIC_KEY = "TIDREMAUaAyrBfCd2";               // Account → General → Public Key
const EMAILJS_SERVICE_ID = "service_o70h87o";                 // Email Services → your service's ID
const EMAILJS_VOUCHER_TEMPLATE_ID = "template_osq0o7n";       // Email Templates → the voucher template's ID
// Store kiosk invite (dashboard → Account Creation). Template HTML: email-templates/store-invite-email.html.
// Leave the template empty to turn invite emails off: the dashboard then copies the link for you to send.
const EMAILJS_STORE_INVITE_SERVICE_ID = "service_ljl4e96";
const EMAILJS_STORE_INVITE_TEMPLATE_ID = "template_pw9egup";
// Only if that service is in a DIFFERENT EmailJS account: its Public Key (empty = same account as above)
const EMAILJS_STORE_INVITE_PUBLIC_KEY = "";

// ---- Cloudinary (employee profile photos) ----
// Browser uploads use an UNSIGNED upload preset. Never put the API key/secret (CLOUDINARY_URL)
// in website code: anyone could read it and delete or overwrite your images.
const CLOUDINARY_CLOUD_NAME = "macowfsm";
const CLOUDINARY_UPLOAD_PRESET = "tablevibe";       // must be set to "Unsigned" in Cloudinary
const CLOUDINARY_EMPLOYEE_FOLDER = "dinepulse/employees";

// Only trust photos from our own Cloudinary account (same check as the Firestore rules)
function isOurCloudinaryUrl(url) {
    return typeof url === "string" && url.startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/`);
}

// Small, face-centred square version of a Cloudinary photo (keeps pages fast)
function cloudinaryThumb(url, size = 160) {
    if (!isOurCloudinaryUrl(url)) return "";
    return url.replace("/image/upload/", `/image/upload/c_fill,g_face,w_${size},h_${size},q_auto,f_auto/`);
}

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBGggVS64CDVXpm498Uk1_FKqiGXyQqNnQ",
    authDomain: "tablevibe-5cd4e.firebaseapp.com",
    projectId: "tablevibe-5cd4e",
    storageBucket: "tablevibe-5cd4e.firebasestorage.app",
    messagingSenderId: "948360893650",
    appId: "1:948360893650:web:a5f1f31adf6dfe32b8c90b",
    measurementId: "G-JY8YXBV4YP"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Firebase App Check: proves requests come from these pages, not a script calling Firebase directly.
// Must be activated before any Firestore/Auth call. Enforce it in the console only after
// App Check → Metrics shows both pages sending verified requests.
// reCAPTCHA adds a hidden element to <body>, which doesn't exist yet while this file runs in <head>.
// So each page calls activateAppCheck() in a tiny script right after its <body> tag
// (before any Firestore call); DOMContentLoaded is only a fallback.
let appCheckActivated = false;
function activateAppCheck() {
    if (appCheckActivated || !document.body) return;
    appCheckActivated = true;
    if (typeof firebase.appCheck !== "function" || !RECAPTCHA_V3_SITE_KEY) {
        if (!RECAPTCHA_V3_SITE_KEY) console.warn("App Check is off: set RECAPTCHA_V3_SITE_KEY in js/firebase-config.js.");
        return;
    }
    try {
        if (["localhost", "127.0.0.1"].includes(location.hostname)) {
            // Local testing: Firebase prints a debug token in the console.
            // Register it in Firebase Console → App Check → Manage debug tokens.
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        // Fraud Defense (reCAPTCHA Enterprise) key. reCAPTCHA Classic is deprecated in App Check.
        firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_V3_SITE_KEY), true);
    } catch (err) {
        console.error("App Check could not start:", err); // the site keeps working while not enforced
    }
}
if (document.body) activateAppCheck();
else document.addEventListener("DOMContentLoaded", activateAppCheck);

const db = firebase.firestore();

// One mailbox = one voucher: "Ana.Cruz+promo@gmail.com" and "anacruz@gmail.com" reach the same inbox,
// so both become "anacruz@gmail.com". Strips +tags everywhere, and dots for Gmail. Used as the voucher
// doc id; the Firestore rules reject ids that still contain a "+" or a dotted Gmail name.
function canonicalEmail(raw) {
    const email = String(raw || "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 1) return email;
    let local = email.slice(0, at).split("+")[0];
    let domain = email.slice(at + 1);
    if (domain === "googlemail.com") domain = "gmail.com";
    if (domain === "gmail.com") local = local.replace(/\./g, "");
    return local + "@" + domain;
}

// Escape any user- or database-supplied value before it goes into innerHTML.
// Survey submissions are publicly writable, so every rendered field must pass through this.
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
