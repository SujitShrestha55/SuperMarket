SUPERPOS FIREBASE DATA FIX

This version keeps the existing SuperPOS UI. Firebase is the source of truth.

Firestore:
stores/main/products
stores/main/sales

IMPORTANT:
- Products and sales are NOT stored in localStorage.
- Firebase Firestore realtime listeners update the UI automatically.
- Add/Edit/Delete products write directly to Firestore.
- POS checkout uses a Firestore transaction: stock deduction and sale creation are atomic.
- Sales History and Dashboard use the realtime Firestore data.
- Local storage is used only for UI/session preferences (theme/login session), not business data.

Firebase setup:
1. Serve the folder with VS Code Live Server.
2. Firebase Authentication: enable Anonymous.
3. Firestore Rules: publish firestore.rules.
4. firebase-config.js contains the web app config for superpos-a2a08.

If delete/edit does not change the screen, open the browser Console and look for a
permission-denied error. That means Firestore Rules or Anonymous Authentication is not configured.
