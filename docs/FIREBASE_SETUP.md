# Firebase setup

The client uses Google Sign-In and Cloud Firestore. Production credentials belong in environment variables and must not be committed. Copy the variable names used in `src/firebase/app.ts` into a local `.env.local` file.

Enable Google as an Authentication provider in the Firebase console. Add the local development host and the production Hosting domain to Authentication's authorized domains.

## Household onboarding and access

Membership is still an allowlist, but normal onboarding now happens in the app. After Google sign-in, a user can create a household or request access to an existing one.

When creating a household, the client atomically creates the root, the owner's membership, and starter configuration. The Firestore rules only permit this as a tightly constrained first write by the signed-in user; they do not permit arbitrary household creation or membership edits.

To join an existing household, share its code from Settings:

```text
Settings → Share this household code
```

The joining user submits the code and remains pending. Existing active members see an access-request alert and can approve or decline it. Approval atomically changes the request and creates the UID-keyed member document. A household code is an identifier, not a password; approval is still required.

For legacy households, the member document remains:

```text
households/{householdId}/members/{authUid}
```

It must contain the auth UID, display name, role (`owner` or `member`), `active: true`, and Firestore timestamps. The document ID must equal the Google auth UID. Existing provisioned households can continue using `VITE_HOUSEHOLD_ID`; new users will be routed into onboarding when they do not yet have access.

## Local emulators

Run `firebase emulators:start` after installing `firebase-tools`, set `VITE_USE_FIREBASE_EMULATORS=true`, and use the demo project ID above (or set `VITE_FIREBASE_PROJECT_ID`). The rules tests use trusted fixtures for existing households; production onboarding is exercised through the constrained create/request/approval rules described above.

There is intentionally no production deployment step in this repository setup guide.

Restore uses the same allowlist boundary. In Firestore, the destination household and its UID-keyed members must already be provisioned, and the destination's economic collections must be empty. The restore operation verifies that the backup member IDs and auth UIDs match before writing data. It never creates or changes the root household or membership allowlist. The UI must show the preflight summary and pass explicit confirmation to `BudgetService.restore`.
