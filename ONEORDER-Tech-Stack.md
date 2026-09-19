# ONEORDER — Technical Stack

Short hand-off reference. Same content as Part J of **ONEORDER-Complete-Feature-Workflow-Spec.md**.

## App / Frontend

- **React Native**, built with **Expo**
- **Expo Go** for day-to-day development (live reload on a real tablet/phone, no build step per change)
- **EAS Build** for the actual installable Android APK — a development build first (needed for real Bluetooth printer access, since Expo Go can't reach native Bluetooth), then a production build once everything's tested

## Backend / Database

- **Firebase**, specifically:
  - **Firestore** as the database (menu, tables, orders, customers, sales history)
  - **Cloud Functions** for the server-side logic that needs to be enforced centrally rather than trusted to each device — the "one active session per table" rule, GST calculation, backup generation
- No separate Python (or any other) backend server — Firebase covers both the database and the server-side logic, so there's nothing extra to host or keep running

## Local storage

- **SQLite**, on-device — this is what makes the app keep working with zero internet and stops data from disappearing on a refresh; it syncs up to Firestore once connectivity is back

## Why this combination

It avoids two things that kept coming up as problems earlier — running your own server (Firebase's Cloud Functions replace that need) and losing data when offline or on refresh (SQLite fixes that directly, independent of whether Firebase is reachable).

## Secrets

Firebase credentials and any service keys go in environment config / EAS secrets, never in source files or these docs.
