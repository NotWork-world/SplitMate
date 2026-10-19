# Phone notifications (Firebase Cloud Messaging)

Without this, everything works and notifications appear in the app's bell list only.
With it, they also appear in the phone's notification panel, and tapping one opens the
bill or payment it's about.

Firebase is Google's free service for this; use the same Google Cloud project as Google Sign-In.

## 1. Add Firebase to the project
1. <https://console.firebase.google.com> → **Add project** → choose your existing Google Cloud
   project **SplitMate** (don't create a new one) → Continue. Google Analytics: off is fine.
2. Project overview → **Add app → Android**.
   - Package name: `world.notwork.splitmate`
   - SHA-1: not needed for notifications.
3. Download **google-services.json** and put it at `mobile/android/app/google-services.json`.
   It's git-ignored; keep a copy with your signing key backup.

## 2. Let the server send
1. Firebase console → ⚙ **Project settings → Service accounts → Generate new private key**.
   A `.json` file downloads. Treat it like a password.
2. Render → splitmate-api → **Environment** → `SPLITMATE_FIREBASE_CREDENTIALS` → paste the
   whole file content → Save. (Locally: put it on one line in `server/.env`.)

## 3. Rebuild the app
`cd mobile/android && gradlew.bat bundleRelease` (or `assembleRelease`). The build picks up
`google-services.json` automatically. On first sign-in, Android 13+ asks to allow notifications.
