# What's different from the original 12-module spec, and why

This backend was built against three explicit decisions you made:
1. Firebase **Spark (free)** plan — no Cloud Functions, no billing account.
2. **Cloudinary** for all file storage (not Firebase Storage).
3. **No separate server** — the client talks to Firestore directly, authorized by
   Security Rules + Custom Claims, not server-verified endpoints.
4. Where the spec needed a true secret-holding server (Resend, Google OAuth, scheduled
   backups), use **free external services** instead of standing one up.

That is a legitimate, working architecture for a real app — but it is a genuinely
different shape than "19 Cloud Functions behind an Admin SDK," and a few things work
differently than literally specified. This file is the honest list.

## 1. Setting a user's role/org/branches requires you to run a script

Firebase Custom Claims (what `firestore.rules` actually trusts for authorization) can
only be set with the Admin SDK, which needs a service-account secret that cannot exist in
browser code. There's no Cloud Function to hold that secret either. So:

- `scripts/set-claims.js` is a Node script **you run locally** whenever a user is created
  or their role/org/branches change.
- The app's `users/{uid}` Firestore doc (role, branchIds) is the *display* copy; the
  claims are the *enforced* copy. `services/users.service.js` reminds you to re-run the
  script every time it updates a role or branch assignment.
- Practically: this is fine for occasional admin actions (new hire, promotion), annoying
  if you're onboarding dozens of users a day. If that becomes your workflow, that's the
  signal to add a small server (or move to Blaze + one Cloud Function just for this).

## 2. Cloudinary uploads are unsigned, not server-signed

The spec called for server-generated signed upload parameters. With no server, this uses
Cloudinary's own documented pattern for secretless clients: **unsigned upload presets**,
locked down per-folder in the Cloudinary dashboard (allowed formats, max size, fixed
folder). See the comment block at the top of `services/cloudinary.service.js` for the
exact preset settings to configure, one preset per `ASSET_FOLDERS` entry.

Deleting a Cloudinary asset for real (not just its Firestore metadata) needs the API
*secret*, not just an API key, so `deleteAsset()` removes the Firestore record immediately
and queues the real deletion; `scripts/drain-cloudinary-deletes.js` (run locally/on a
schedule) does the actual Cloudinary-side delete.

## 3. Email uses EmailJS, not Resend

Resend's API needs a server to hold its API key. EmailJS is built to send mail straight
from the browser with a public key that's rate-limited per domain in their dashboard.
Trade-offs: free tier caps at 200 emails/month, and the email content/recipient is
visible in browser network traffic (never put anything sensitive a customer shouldn't see
into these templates). If you outgrow this, swapping `services/email.service.js` for a
Resend-backed Cloud Function later is a contained change — nothing else in the app talks
to email directly except through this file.

## 4. Push notifications only reach devices with the app open

In-app notifications (the Firestore `notifications` feed) work exactly as specified.
Actual FCM *push* to a closed app/browser tab requires an HTTP v1 API call signed with a
service account — a server-side call, which doesn't exist here. `registerForPush()` and
`onForegroundMessage()` cover push while the app is open; true background push is the one
piece that needs a server (or Blaze + a tiny Cloud Function) to add later.

Alerting on new/negative feedback is handled by **each logged-in staff member's own
client self-subscribing** (`subscribeToBranchFeedbackAlerts`) rather than the (anonymous)
customer who submitted the feedback trying to notify others — that customer has no write
permission to do so, by design. See the comment block in `notifications.service.js`.

## 5. Google Business Profile OAuth uses a "Desktop app" client type

Google's OAuth token endpoint requires a `client_secret` for every client type except
"Desktop app" (installed app), which Google's own docs treat as inherently non-
confidential. Registering the integration as a Desktop-app OAuth client + PKCE lets the
full authorization-code exchange and refresh-token flow run from the browser without a
server, legitimately (not a workaround). Verify in your own testing that Google's token
endpoint and the Business Profile REST API accept CORS requests from your domain — if
Google changes that, this is the one integration that would need a thin server-side
proxy. See `docs/TEST-PLAN.md`.

## 6. Scheduled backups run on GitHub Actions, targeting Cloudinary, not GCS

Cloud Scheduler + a Cloud Function (the spec's mechanism) requires Blaze. A GCS bucket
itself typically requires a billing-enabled GCP project too. The free substitute:
`.github/workflows/firestore-backup.yml` runs `scripts/backup-firestore.js` on a daily
cron (GitHub Actions' free tier), which exports every collection and uploads a dated,
gzipped JSON archive to Cloudinary (`tablevibe/generated_reports/backups/`), with a
30-day retention sweep and a Firestore-logged success/failure record the dashboard reads
via `services/backup.service.js`. `scripts/restore-firestore.js` is the documented,
tested restore path — always test it against a staging Firebase project first.

## 7. Reports do bounded reads, not a full scan, but aren't pre-aggregated

Firestore's `count()` aggregation is used wherever a report only needs a number (e.g.
unresolved vs. resolved counts), which is cheap even on the free tier. Reports needing
distributions (e.g. rating buckets) read a capped page (2,000 rows) of filtered documents
client-side rather than scanning the whole collection. This is fine at small-to-medium
data volumes; the spec's own suggestion — scheduled summary documents, or BigQuery once
volume grows — still applies and isn't built here, since it's explicitly a "grow into it"
item in the original spec, not a day-one requirement.

## What's fully real and working, no caveats

Firestore schema + 22 collections, security-rule-enforced RBAC + branch isolation with
penetration-style tests in the test plan, survey versioning with immutable historical
answers, idempotent writes, atomic/race-free reward redemption, the full feedback
lifecycle, immutable audit logging, Sentry error tracking, and CSV/Excel/PDF report
exports all work exactly as specified, with no server required.
