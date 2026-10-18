# Publish SplitMate on Google Play

The code is ready for Google Play. What's left needs the app owner: the developer account, the upload key, screenshots and the Play Console forms.

## Already done in the project

| Requirement | Status |
|---|---|
| Target API level (Android 16, API 36) | `targetSdkVersion 36` |
| 16 KB memory pages | React Native 0.87, Hermes and the libraries used ship 16 KB-aligned native libraries |
| Android App Bundle | `bundleRelease`, shrunk with R8 + resource shrinking; native debug symbols included |
| Version code that always grows | From `mobile/package.json` (`1.2.3` → `10203`) |
| Signing | Upload key from Gradle properties; bundles refuse to build without it |
| Permissions | Internet, network state, vibration. No storage, camera, location or contacts permission (photo picker and camera app intents) |
| Cleartext traffic | Off, except to a development server on the computer (`network_security_config.xml`) |
| Privacy policy | [privacy-policy.md](privacy-policy.md) — publish it at a public URL |
| Listing text and graphics | `mobile/fastlane/metadata/android/en-US/` (title, descriptions, release notes, 512 px icon, 1024×500 feature graphic) |

## 1. Upload key (once)

```bash
keytool -genkeypair -v -keystore splitmate-upload.jks -alias splitmate-upload -keyalg RSA -keysize 2048 -validity 10000
```

Keep the `.jks` file and password backed up outside the repository. Add to `C:\Users\<you>\.gradle\gradle.properties` (not the project's):

```properties
SPLITMATE_UPLOAD_STORE_FILE=C:/keys/splitmate-upload.jks
SPLITMATE_UPLOAD_STORE_PASSWORD=...
SPLITMATE_UPLOAD_KEY_ALIAS=splitmate-upload
SPLITMATE_UPLOAD_KEY_PASSWORD=...
```

## 2. Build

1. Make sure the server is deployed ([deploy.md](deploy.md)) and `DEFAULT_API_URL` in `mobile/src/config.ts` points at it.
2. Raise `version` in `mobile/package.json` for every upload.
3. `cd mobile/android && gradlew.bat bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.

`assembleRelease` makes a test APK (signed with the upload key if configured, otherwise the debug key).

## 3. Play Console

- **Create app:** SplitMate · App · Free.
- New personal developer accounts must run a **closed test with at least 12 testers for 14 days** before production.
- **Category:** Finance. **Ads:** none. **Target audience:** 13+.
- **Financial features declaration:** SplitMate records shared expenses and lets people confirm repayments they made elsewhere; it does not process payments, hold money, lend, or offer financial products. Answer accordingly ("none of the above" for regulated financial services).
- **App access:** reviewers can create an account with any email inside the app.

### Data safety answers

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Required | Account management, app functionality |
| Email address | Yes | No | Required (or Google account) | Account management |
| User IDs (Google account id) | Yes, when using Google sign-in | No | Optional | Account management |
| Financial info → Other financial info (expenses, shares, repayments) | Yes | No | Required | App functionality |
| Financial info → UPI ID | Yes | No | Optional | App functionality |
| Photos (receipt photos the user attaches) | Yes | No | Optional | App functionality |
| App activity → Other user-generated content (notes, receipt text sent for parsing) | Yes | No | Optional | App functionality |

- Encrypted in transit: **Yes**. Users can request deletion: **Yes** (in-app, Settings → Delete my account).
- Not collected: location, contacts, device IDs, diagnostics, analytics, messages, health.

## 4. Screenshots

2–8 phone screenshots. Good choices: the swipe card with people selected, the bill review with CGST/SGST lines, a group's suggested payments, a repayment awaiting confirmation, and the home dashboard. Save them in `fastlane/metadata/android/en-US/images/phoneScreenshots/`.

## 5. After the first upload

- Register the Play app-signing SHA-1 as a second Android OAuth client ([google-sign-in.md](google-sign-in.md)).
- Check the **pre-launch report** for crashes after each upload.
