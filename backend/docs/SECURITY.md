# Security & Performance Checklist (BACKEND-11)

## Defense in depth

- [x] **Firestore Security Rules** (`firestore.rules`) are the sole authorization layer
      — every collection has an explicit allow/deny, default-deny catch-all at the
      bottom. Review this file end-to-end before go-live; it is the entire security
      boundary of this app in a way it wouldn't be if Cloud Functions existed too.
- [x] **Branch isolation**: every branch-scoped collection checks `inBranch()`, which
      requires the document's `branchId` to be in the caller's own Custom Claim
      `branchIds` array (or the caller to be admin/super_admin). A staff member cannot
      read or write another branch's data by crafting a request with a different
      `branchId` — rules check the *resource's* branchId, not a client-asserted one.
- [x] **Org isolation**: every collection checks `sameOrg()` against the caller's
      `orgId` claim.
- [x] **Server-side authorization** — N/A in the Cloud Functions sense (there is no
      server), but the equivalent exists: rules evaluate against Custom Claims that only
      `scripts/set-claims.js` (Admin SDK, run outside the browser) can set — the client
      can never self-assign a role or org.
- [ ] **Firebase App Check**: not wired up in this pass. App Check needs a reCAPTCHA
      Enterprise or App Check provider configured per-app; add
      `initializeAppCheck()` to `firebase-config.js` once you've registered a provider in
      the console. Recommended before heavy public traffic (it protects the public
      `feedback`/`qr_codes` write paths from scripted abuse).
- [x] **Input validation**: every service module validates required fields
      (`requireFields`) and enums (`assertEnum`) before writing; rules re-validate the
      security-relevant fields (status transitions, immutability) independently, so a
      compromised client still can't bypass the real constraints.
- [ ] **Endpoint rate limiting**: there's no server to rate-limit at. The closest
      equivalents on Spark: Firestore's own per-project quotas (a natural ceiling),
      App Check (above) to cut off non-browser scripted traffic, and `qr_codes`' scan
      increment being the only unauthenticated write besides `feedback` creation — both
      are intentionally narrow in what they can mutate. If abuse becomes a real problem,
      that's a concrete signal to add a minimal server/Blaze just for those two endpoints.
- [x] **Secure secret storage**: real secrets (Firebase service account, Cloudinary API
      secret, GitHub Actions) never touch the browser — see LIMITATIONS.md §1,2,6 for
      exactly which secret lives where. Client-shipped values (Firebase web config,
      Cloudinary cloud name/unsigned preset, EmailJS public key, Google Desktop OAuth
      client ID+secret, Sentry DSN) are all values their own providers document as safe
      to ship client-side.
- [x] **Cloudinary signed uploads** — adapted to unsigned presets with dashboard-side
      lockdown; see LIMITATIONS.md §2 for the exact trade-off and preset settings needed.
- [x] **Encrypted integration tokens**: Google's access/refresh tokens are stored in
      `google_integrations/{orgId}`, readable only by `isAdmin()` of that exact org per
      the rules — there's no client-side encryption-at-rest without a server-held key
      (encrypting with a client-visible key provides no real protection), so the control
      that actually matters here is the strict read lockdown, which is in place.

## Performance & cost control

- [x] Firestore composite indexes defined for the hot query paths (`firestore.indexes.json`)
- [x] Pagination: `listFeedback` uses cursor-based pagination; reports cap at 2,000 rows
- [ ] Monitor read/write billing quotas: Spark's free quota is generous but finite (50K
      reads/day, 20K writes/day, 20K deletes/day as of this writing — verify current
      numbers in the Firebase Console, they do change). Watch Firebase Console → Usage
      dashboard, especially once reports and the backup script are both reading in bulk.
- [x] Structured logging: `activity_logs` (audit) + `email_logs` + the backup run log
      cover the operational trail; Sentry (`services/sentry.init.js`) covers exceptions.

## Penetration verification (do this before go-live)

`docs/TEST-PLAN.md` has the concrete steps, but the principle: sign in as a `staff` or
`branch_manager` user scoped to Branch A, then attempt — via the browser console, not the
UI — to read or write a Branch B document by hand-constructing the Firestore call with
Branch B's ID. Every such attempt must be rejected with `permission-denied`. Do this for
at least: `branches`, `employees`, `feedback`, `feedback_replies`, `google_integrations`,
`reward_redemptions`, `activity_logs`. Also verify a signed-out (anonymous) client cannot
read `users`, `google_integrations`, or `activity_logs` at all, and can only *create* (not
read or list) `feedback` and increment `qr_codes.scanCount` by exactly 1.
