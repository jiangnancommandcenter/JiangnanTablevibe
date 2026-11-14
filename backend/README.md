# TableVibe Backend

A full implementation of the 12-module Backend Development Prompt Collection
(BACKEND-01 through BACKEND-12, plus the Phase 5 function/rule standardization), adapted
to run on **Firebase Spark (free plan), Cloudinary for storage, no Cloud Functions, no
separate server**. Start here:

1. **`docs/LIMITATIONS.md`** — read this first. It's the honest diff between "what the
   spec asked for" and "what's actually possible with no server," and why each
   adaptation is a legitimate pattern rather than a shortcut.
2. **`schema/SCHEMA.md`** — the full 22-collection data model (plus 2 supporting
   collections this build added: `cloudinary_assets`, `cloudinary_delete_queue`).
3. **`firestore.rules`** — the entire authorization layer. Read this like you would read
   the backend's route handlers in a traditional server, because that's what it is here.
4. **`docs/DEPLOYMENT.md`** — step-by-step setup, in order.
5. **`docs/SECURITY.md`** and **`docs/TEST-PLAN.md`** — the hardening checklist and the
   test matrix to actually run (not just read) before go-live.

## Folder map

```
backend/
  firebase-config.js         Firebase app/Auth/Firestore/Messaging init
  firestore.rules            The authorization layer (BACKEND-03/11)
  firestore.indexes.json     Composite indexes (BACKEND-02/08)
  config/
    env.template.js          Copy to env.js and fill in
    roles.js                 5-role permission matrix (UX only — rules are the real check)
  services/                  One module per domain, all plain ES modules, no build step
    auth.service.js            BACKEND-03
    users.service.js           BACKEND-05 (role/branch changes)
    branches.service.js        BACKEND-05
    surveys.service.js         BACKEND-02/05 (versioning)
    qr.service.js               BACKEND-05
    feedback.service.js         BACKEND-05
    rewards.service.js          BACKEND-05 (race-free redemption)
    cloudinary.service.js       BACKEND-04
    notifications.service.js    BACKEND-06
    email.service.js            BACKEND-06 (EmailJS)
    google-business.service.js  BACKEND-07 (PKCE OAuth + review sync)
    reports.service.js          BACKEND-08 (9 reports + CSV/XLSX/PDF export)
    audit.service.js            BACKEND-09
    sentry.init.js               BACKEND-09
    backup.service.js            BACKEND-10 (reads the backup log)
    firestore-helpers.js         shared validation/idempotency helpers
  scripts/                   Node scripts that hold REAL secrets — never run in the browser
    set-claims.js               BACKEND-03 (sets Custom Claims)
    drain-cloudinary-deletes.js BACKEND-04 (real Cloudinary deletes)
    backup-firestore.js         BACKEND-10 (runs on a schedule via GitHub Actions)
    restore-firestore.js        BACKEND-10 (restore runbook)
  docs/
    DEPLOYMENT.md
    SECURITY.md
    LIMITATIONS.md
    TEST-PLAN.md
.github/workflows/
  firestore-backup.yml       Free scheduled backup (GitHub Actions, no Blaze needed)
```

## Wiring into the existing `dashboard.html`

Nothing here has a build step. Add `type="module"` script tags that import whichever
service functions a given screen needs, e.g.:
```html
<script type="module">
  import { login } from './backend/services/auth.service.js';
  import { listFeedback } from './backend/services/feedback.service.js';
  // ...wire up your existing dashboard.html UI handlers to these
</script>
```
The dashboard's existing nav items (Dashboard, Inbox, Surveys, QR Codes, Venues, ...)
map directly onto these services — Inbox → `feedback.service.js`, Surveys →
`surveys.service.js`, QR Codes → `qr.service.js`, Venues → `branches.service.js`, and so
on. None of the existing HTML/Tailwind markup needs to change structurally; this backend
is additive.
