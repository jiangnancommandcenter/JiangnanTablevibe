# Deployment (BACKEND-01 / BACKEND-12)

## 1. Create/confirm the Firebase project
You said this already exists. Confirm it's on **Spark** (Project Settings → Usage and
billing). If it shows Blaze, you can either downgrade or just ignore the Cloud Functions
pieces of this build — everything here still works on Blaze, it just doesn't need it.

## 2. Install the Firebase CLI and log in
```
npm install -g firebase-tools
firebase login
firebase use --add   # pick your project, give it the alias "production"
```
For environment separation (BACKEND-01), create a second Firebase project for
Development/staging and `firebase use --add` it with the alias "development". Run
everything below against development first.

## 3. Deploy Firestore rules + indexes
```
firebase deploy --only firestore:rules,firestore:indexes
```
The first time you run reports against real data, Firestore may reject a query with a
"this query requires an index" error containing a direct console link — click it, it
creates the missing composite index in one click. This is normal and expected; the
`firestore.indexes.json` here covers the predictable ones.

## 4. Fill in config/env.js
```
cp config/env.template.js config/env.js
```
Fill in: Firebase web config (Project Settings → General → Your apps → Web app — create
one if you haven't), Cloudinary cloud name + an unsigned upload preset per
`ASSET_FOLDERS` (see `services/cloudinary.service.js`), EmailJS service/template IDs,
Google OAuth Desktop-app client ID+secret, Sentry DSN. `env.js` should be in
`.gitignore` — never commit it with real values.

## 5. Seed roles/permissions and your first super_admin
1. Firebase Console → Authentication → add your own user (email/password).
2. Run:
   ```
   node scripts/set-claims.js --sa ~/tablevibe-service-account.json \
     --uid YOUR_UID --org YOUR_ORG_ID --role super_admin
   ```
3. From the app (once wired into dashboard.html), call `createUserProfile` for that same
   uid/org/role so the Firestore display doc matches the claims.
4. Seed the five `roles/{roleId}` docs by hand in the Firebase Console using
   `config/roles.js` as the source — these are reference data the app reads but doesn't
   write at runtime.

## 6. Wire the services into dashboard.html
Add `<script type="module" src="backend/firebase-config.js"></script>` (or import the
specific services you need) into the existing dashboard. Since there's no bundler here,
every service file is a plain ES module importable directly by path — no build step.

## 7. Local development against emulators
```
firebase emulators:start --only auth,firestore
```
`firebase-config.js` auto-connects to the emulators when served from localhost. Cloudinary,
EmailJS, Google OAuth, and Sentry all still hit their real endpoints even in emulator mode
(there's no free local emulator for those) — use test/sandbox credentials for those
services while developing if you want to avoid real sends/charges.

## 8. Automated backups
Push this repo to GitHub, then add these repo secrets (Settings → Secrets and variables →
Actions): `FIREBASE_SERVICE_ACCOUNT_JSON` (paste the whole downloaded JSON),
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The
`firestore-backup.yml` workflow then runs daily automatically; trigger it manually any
time from the Actions tab ("Run workflow") for an on-demand backup.

## 9. Deploying the frontend
Firebase Hosting works fine on Spark:
```
firebase init hosting   # point it at the TableVibe folder
firebase deploy --only hosting
```

## Deployment readiness checklist (BACKEND-12)
- [ ] `firestore.rules` deployed and tested against `docs/TEST-PLAN.md`
- [ ] `firestore.indexes.json` deployed, no pending index-required errors in normal use
- [ ] `config/env.js` filled in for the target environment, not committed
- [ ] Cloudinary unsigned presets created, one per `ASSET_FOLDERS` entry, locked down
- [ ] First `super_admin` claims set and verified (can log in, sees admin UI)
- [ ] GitHub Actions backup workflow run once manually and verified in
      `system_settings/__backup_log__/runs`
- [ ] A restore drill run against a staging project (not production)

Do not check any of these off, or tell anyone deployment is done, until you've actually
run it and watched it succeed — per the spec's own verification constraint.
