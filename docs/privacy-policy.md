# SplitMate Privacy Policy

_Last updated: 18 October 2026_

SplitMate ("the app") is published by NotWork World. This policy explains what the app and its server store, why, and the choices you have.

## What we store

| Data | Why | Who can see it |
|---|---|---|
| Name and email address, or your Google account identifier if you sign in with Google | To create your account and sign you in | You; your name is shown to people in groups you join |
| A password hash (Argon2), never the password itself | Email sign-in | Nobody |
| Groups, members you add by name, expenses, items, who had each item, who paid, discounts, taxes and charges | To work out who owes whom | Members of that group |
| Repayment requests, confirmations, disputes and notes | To settle balances transparently | The two people involved and members of that group |
| Receipt photos you choose to attach | To keep the bill with the expense | Members of that group, through links that expire after a few minutes |
| Optional UPI ID | So group members can open their UPI app to pay you | Members of your groups |
| Notification preferences and an audit log of financial changes | To respect your settings and explain every balance | You (preferences); the audit log is internal |

We do **not** collect location, contacts, device identifiers, advertising IDs or analytics, and the app contains no ads or third-party tracking SDKs.

## Receipt scanning

Receipt text is recognised **on your phone** by Google ML Kit's on-device text recognition. Only the recognised text is sent to the SplitMate server so it can be sorted into items, taxes and totals. That text is not stored unless you add the items to a bill. Photos are uploaded only if you choose to attach them.

## Payments

SplitMate does not move money and does not see your bank or UPI accounts. Opening "your UPI app" hands over to the app you choose. A payment changes balances only when the person who received it confirms it in SplitMate.

## Where data is kept

The server runs on Render (Singapore region), the database on Neon (PostgreSQL), and receipt photos on the server's private disk only until the bill is finalised or cancelled, when the photo is deleted (the typed-in items and prices stay). Unused photos are deleted after two days. All traffic uses HTTPS. Your sign-in session is stored in Android's secure keystore on your phone.

## Your choices

- **Export:** Settings → Your data → Export my data gives you everything about you as JSON.
- **Delete:** Settings → Your data → Delete my account removes your profile, sign-in details, personal expenses and preferences immediately. Expenses you shared with others stay in their groups under the name "Deleted user", so other people's balances remain correct.
- **Notifications:** turn each kind on or off in Settings.

## Children

SplitMate is not directed at children under 13.

## Contact

Questions or requests: open an issue at the project's GitHub repository, or email the address on the Google Play listing.
