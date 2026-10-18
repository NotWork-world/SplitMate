# Set up Google Sign-In

Email sign-in works without any of this. Google Sign-In needs two free OAuth clients in Google Cloud.

1. <https://console.cloud.google.com> → create a project "SplitMate".
2. **APIs & Services → OAuth consent screen**: External, app name SplitMate, support email, privacy policy URL. Scopes: just `email`, `profile`, `openid`. Publish it (**In production**) so anyone can sign in.
3. **Credentials → Create credentials → OAuth client ID → Web application**, name "SplitMate server". Copy its **Client ID**; this is `SPLITMATE_GOOGLE_CLIENT_IDS` on the server. The app gets it from `/api/health`, so no rebuild is needed.
4. **Create credentials → OAuth client ID → Android**, package `world.notwork.splitmate`, SHA-1 of the signing key:
   - your **upload key**: `keytool -list -v -keystore splitmate-upload.jks -alias splitmate-upload`
   - after the first Play upload, also the **Play app signing key** (Play Console → Test and release → App integrity → App signing), as a second Android client.
   - for debug builds: `keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android`

The server verifies every Google ID token's signature, issuer and audience (`app/integrations/google.py`). It links a Google account to an existing email account only when Google says the email is verified.

Until step 3 is done, the app shows "Google sign-in isn't set up on this server yet" and the button stays disabled.
