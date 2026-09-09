# Firebase setup

The client uses Google Sign-In and Cloud Firestore. Production credentials belong in environment variables and must not be committed. Copy the variable names used in `src/firebase/app.ts` into a local `.env.local` file.

Enable Google as an Authentication provider in the Firebase console. Add the local development host and the production Hosting domain to Authentication's authorized domains.

## Secure household provisioning

Membership is an allowlist. A membership document is created by a trusted provisioning path (Firebase console, Admin SDK, or a controlled migration script) at:

```text
households/{householdId}/members/{authUid}
```

The document must include the member's auth UID, display name, role (`owner` or `member`), `active: true`, and ISO-equivalent Firestore timestamps. The document ID must equal the Google auth UID. The client cannot create or update membership documents and cannot create a household, so signing in never grants access by itself. All active members have equal read/write access to ordinary household data; owner/member is retained for controlled provisioning and future administration.

Create the household document and initial member documents before opening the app. To add a user, first obtain the user's Firebase Auth UID after their first Google sign-in, then provision the UID document out of band. Set `active` to false to revoke access without deleting historical references.

## Local emulators

Run `firebase emulators:start` after installing `firebase-tools`, set `VITE_USE_FIREBASE_EMULATORS=true`, and use the demo project ID above (or set `VITE_FIREBASE_PROJECT_ID`). Emulator rules tests should seed memberships directly through the Admin SDK/rules test utilities; a client must never be able to self-enroll.

There is intentionally no production deployment step in this repository setup guide.

Restore uses the same allowlist boundary. In Firestore, the destination household and its UID-keyed members must already be provisioned, and the destination's economic collections must be empty. The restore operation verifies that the backup member IDs and auth UIDs match before writing data. It never creates or changes the root household or membership allowlist. The UI must show the preflight summary and pass explicit confirmation to `BudgetService.restore`.
