# Integration Test Matrix (BACKEND-12)

No Cloud Functions means no `firebase emulators:exec` function tests — but the Firestore
emulator + its own rules-testing library covers everything that matters here, since rules
*are* the backend. Two layers:

## A. Automated rules tests (recommended: `@firebase/rules-unit-testing`)

```
npm install --save-dev @firebase/rules-unit-testing vitest
firebase emulators:start --only firestore
```
Write one test file per collection asserting: an org-A admin can read/write org-A docs
and cannot read/write org-B docs; a branch-scoped staff user can read/write their own
branch and not another; an anonymous client can create `feedback` with valid shape and
cannot read any `feedback`; `activity_logs` rejects every update/delete attempt
regardless of role, including super_admin. This file intentionally doesn't ship a full
test suite (it depends on your exact test runner preference) but every scenario above is
a direct translation of a `firestore.rules` branch — write one assertion per `match`
block's `allow` line.

## B. Manual verification checklist — run each of these for real and check the box only once it's actually passed

- [ ] **Authentication**: sign up, log in, log out, forgot/reset password, change
      password while logged in, email verification link, account deactivation blocks
      login, MFA enrollment + MFA-challenged login
- [ ] **User authorization**: a `viewer` cannot create/edit anything (every mutating
      button is either hidden or rejected server-side if forced); a `staff` can resolve
      feedback but not create branches; an `admin` can do both
- [ ] **Branch restrictions**: see the penetration steps in `docs/SECURITY.md`
- [ ] **Database operations**: create/read/update across every collection in
      `schema/SCHEMA.md` at least once; confirm `feedback` answers truly cannot be edited
      after resolution (only status/resolvedBy/resolvedAt change)
- [ ] **Cloudinary uploads and deletion**: upload one asset per `ASSET_FOLDERS` folder,
      confirm it lands in the right Cloudinary folder with the preset's constraints
      enforced (try uploading a disallowed file type/oversized file and confirm
      Cloudinary itself rejects it); delete an asset, confirm the Firestore record is
      gone immediately and a `cloudinary_delete_queue` entry was created; run
      `drain-cloudinary-deletes.js` and confirm the asset is actually gone from Cloudinary
- [ ] **EmailJS sending**: trigger each of the 5 templates for real, confirm delivery and
      that `email_logs` recorded `status: 'sent'`; force a failure (bad template id) and
      confirm `status: 'failed'` with a real error message
- [ ] **FCM/in-app notifications**: confirm the in-app feed updates in real time for a
      logged-in staff member when new feedback arrives in their branch; confirm
      `markNotificationRead` only ever lets a user mark their own notifications
- [ ] **Feedback submission**: submit via a QR code's `targetUrl` as a fully anonymous
      (not logged in, private/incognito window) user; confirm `qr_codes.scanCount`
      incremented by exactly 1 and cannot be incremented by more in one call
- [ ] **Google review synchronization**: complete the OAuth flow end-to-end against a
      real (test) Google Business Profile, run `syncGoogleReviews`, confirm reviews
      appear in Firestore AND that re-running sync doesn't create duplicates (same
      `googleReviewId` → same deterministic doc id); confirm a deliberately broken
      access token produces `lastSyncStatus: 'error'` rather than a false "success" —
      this is the spec's explicit "never simulate successful synchronization" constraint
- [ ] **Report generation**: run all 9 report types with at least one filter combination
      each; export each to CSV, Excel, and PDF and open every file to confirm it's valid
      and matches what's on screen
- [ ] **Database backups**: trigger the GitHub Actions workflow manually
      (`workflow_dispatch`), confirm it completes, confirm the Cloudinary archive exists,
      confirm `system_settings/__backup_log__/runs` has a new `status: 'ok'` entry;
      separately, run `restore-firestore.js --dry-run` against that archive and read the
      output; then actually restore it into a staging project and spot-check documents
- [ ] **Firestore security rules**: the full matrix in `docs/SECURITY.md` §Penetration
      verification

## Deployment verification (do not report this as done otherwise)

- [ ] Deployed rules/indexes match what's in this repo (`firebase deploy --only
      firestore:rules,firestore:indexes` run with no errors, console shows them live)
- [ ] A real user, in the real deployed app (not localhost), can complete the full
      feedback-submission → staff-sees-alert → resolve → report flow end to end
