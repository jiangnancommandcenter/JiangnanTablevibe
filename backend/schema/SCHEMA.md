# TableVibe Firestore Schema (BACKEND-02)

Architecture note: this build runs on **Firebase Spark (free) plan with no Cloud Functions
and no separate server** (per project decision). All reads/writes happen from the client
via the Firebase JS SDK and are enforced by `firestore.rules`. Where the original spec
assumed server-verified logic, the equivalent check is now a security-rule check against
`request.auth.token` custom claims and sibling documents. See `docs/LIMITATIONS.md` for
the handful of things (true secret-holding server calls) this can't fully replicate.

Every document below carries `organizationId` (tenant root) and, where applicable,
`branchId`, so rules can isolate tenants/branches with `resource.data.organizationId ==
request.auth.token.orgId`. IDs are Firestore auto-IDs unless noted.

## Identity & Access

### `users/{uid}` (uid = Firebase Auth UID)
```
organizationId: string
branchIds: string[]          // branches this user can access ([] for org-wide roles)
role: 'super_admin' | 'admin' | 'branch_manager' | 'staff' | 'viewer'
email: string
displayName: string
photoURL: string | null
status: 'active' | 'deactivated'
mfaEnabled: boolean
createdAt: serverTimestamp
updatedAt: serverTimestamp
createdBy: string (uid)
```
Custom claims mirror `organizationId` -> `orgId` and `role` -> `role` (see
`services/auth.service.js`). Claims are the source of truth for rules; the document is
the source of truth for UI/display and is kept in sync by the app on every role change.

### `roles/{roleId}`
```
name: string                 // matches role enum above
permissions: string[]        // permission keys, see config/roles.js
scope: 'organization' | 'branch'
```
Seed data only — five fixed documents, one per role. Not user-editable at runtime.

### `permissions/{permissionId}`
```
key: string                  // e.g. 'feedback.resolve'
description: string
```
Reference/catalog collection for the permission matrix in `config/roles.js`.

## Organization Structure

### `organizations/{orgId}`
```
name: string
plan: 'free'
ownerUid: string
createdAt: serverTimestamp
settingsRef: 'system_settings/{orgId}'
```

### `branches/{branchId}`
```
organizationId: string
name: string
address: string
googlePlaceId: string | null
managerUid: string | null
status: 'active' | 'inactive'
createdAt: serverTimestamp
updatedAt: serverTimestamp
```

### `employees/{employeeId}`
```
organizationId: string
branchId: string
uid: string | null            // linked login account, optional
name: string
position: string
photoAssetId: string | null    // -> cloudinary metadata doc
status: 'active' | 'inactive'
createdAt: serverTimestamp
```

## Surveys & Feedback

### `surveys/{surveyId}`
```
organizationId: string
branchId: string | null        // null = org-wide survey
title: string
version: number                 // incremented on edit; old versions preserved, see below
questions: [{ id, type: 'rating'|'text'|'choice', label, options?: string[] }]
status: 'draft' | 'published' | 'archived'
createdAt: serverTimestamp
updatedAt: serverTimestamp
```
**Versioning rule:** editing a published survey writes a *new* document
(`surveyId_v{n}`) rather than mutating in place; `feedback` always stores the exact
`surveyId` + `surveyVersion` it was answered against, so historical answers never shift
meaning under you.

### `feedback/{feedbackId}`
```
organizationId: string
branchId: string
surveyId: string
surveyVersion: number
employeeId: string | null
customerName: string | null     // optional, anonymous allowed
customerContact: string | null
answers: [{ questionId, value }]  // immutable once submitted
overallRating: number
status: 'new' | 'in_progress' | 'resolved'
resolvedBy: string | null
resolvedAt: timestamp | null
createdAt: serverTimestamp
```

### `feedback_replies/{replyId}`
```
feedbackId: string
organizationId: string
branchId: string
authorUid: string
message: string
createdAt: serverTimestamp
```

### `feedback_categories/{categoryId}`
```
organizationId: string
label: string
color: string
```

### `qr_codes/{qrId}`
```
organizationId: string
branchId: string
surveyId: string
label: string
targetUrl: string                // public feedback form URL, qrId embedded
scanCount: number                // incremented client-side via transaction
createdAt: serverTimestamp
```

## External Reviews & Rewards

### `google_integrations/{orgId}`
```
organizationId: string
connected: boolean
googleAccountId: string | null
locationIds: string[]
accessToken: string | null        // see LIMITATIONS.md: cannot be encrypted at rest
refreshToken: string | null       // without a server; locked down via strict rules
tokenExpiresAt: timestamp | null
lastSyncAt: timestamp | null
lastSyncStatus: 'ok' | 'error' | null
lastSyncError: string | null
```
Rules restrict read/write of this whole collection to `role in ['super_admin','admin']`
of the matching `organizationId` — no other role, including branch_manager, can read it.

### `google_reviews/{reviewId}` (reviewId = Google's own review name, for dedupe)
```
organizationId: string
branchId: string
googleReviewId: string
authorName: string
rating: number
comment: string
googleCreateTime: timestamp
replyText: string | null
replyPostedAt: timestamp | null
syncedAt: serverTimestamp
```

### `rewards/{rewardId}`
```
organizationId: string
title: string
description: string
pointsCost: number | null
code: string                      // redemption code
status: 'active' | 'inactive'
createdAt: serverTimestamp
```

### `reward_redemptions/{redemptionId}`
```
organizationId: string
branchId: string
rewardId: string
customerContact: string
redeemedBy: string (uid)          // staff who validated it
redeemedAt: serverTimestamp
```
Redemption is a transaction that checks no prior redemption exists for the same
customerContact+rewardId within the reward's cooldown window (duplicate prevention).

## Comms, Reports & System

### `notifications/{notificationId}`
```
organizationId: string
branchId: string | null
recipientUid: string
type: string                      // 'feedback_alert' | 'negative_rating' | ...
title: string
body: string
read: boolean
createdAt: serverTimestamp
```

### `notification_settings/{uid}`
```
organizationId: string
emailAlerts: boolean
pushAlerts: boolean
negativeRatingThreshold: number
```

### `reports/{reportId}`
```
organizationId: string
type: string                      // one of the 9 report types
filters: object
generatedBy: string (uid)
format: 'pdf' | 'xlsx' | 'csv'
assetId: string | null            // -> cloudinary metadata doc for the exported file
createdAt: serverTimestamp
```

### `activity_logs/{logId}` (append-only, see rules)
```
organizationId: string
branchId: string | null
actorUid: string
action: string                    // e.g. 'role.update', 'feedback.resolve'
before: object | null
after: object | null
createdAt: serverTimestamp         // server-generated, never client-supplied
```

### `system_settings/{orgId}`
```
organizationId: string
timezone: string
retentionPolicyDays: number
features: object
```

### `email_logs/{logId}`
```
organizationId: string
to: string
template: string
provider: 'emailjs'
status: 'sent' | 'failed'
error: string | null
createdAt: serverTimestamp
```

### `integrations/{integrationId}`
```
organizationId: string
type: 'google_business' | 'emailjs' | 'cloudinary'
config: object                    // non-secret config only (cloud name, service id, etc.)
updatedAt: serverTimestamp
```

### `cloudinary_assets/{assetId}`
```
organizationId: string
branchId: string | null
ownerUid: string
folder: string                    // one of ASSET_FOLDERS
publicId: string
secureUrl: string
bytes: number
format: string
width: number | null
height: number | null
relatedCollection: string | null  // e.g. 'employees', 'surveys'
relatedId: string | null
createdAt: serverTimestamp
```

### `cloudinary_delete_queue/{queueId}`
```
organizationId: string
publicId: string
folder: string
requestedBy: string (uid)
requestedAt: serverTimestamp
status: 'pending' | 'processed'
```
Drained by `scripts/drain-cloudinary-deletes.js` (the one other place, besides
set-claims.js, that needs a real secret — the Cloudinary API secret — run locally).

## Composite indexes (see firestore.indexes.json)
- `feedback`: (organizationId, branchId, status, createdAt desc)
- `feedback`: (organizationId, branchId, overallRating, createdAt desc)
- `activity_logs`: (organizationId, actorUid, createdAt desc)
- `google_reviews`: (organizationId, branchId, googleCreateTime desc)
- `reward_redemptions`: (rewardId, customerContact, redeemedAt desc)
