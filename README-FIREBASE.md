SUPERPOS FIREBASE — SETUP (updated)

This version replaces the old local, per-browser login with real Firebase
accounts, and makes "admin only" actions actually enforced on the server
(Firestore Security Rules), not just hidden in the UI.

WHAT CHANGED
- Login is now email + password via Firebase Authentication, instead of a
  username/password list stored in localStorage. That's what was causing
  "changing my password only works on this device" — the old passwords
  never left the browser. Firebase Authentication is the same account
  everywhere you sign in.
- "Forgot password" sends a real reset email via Firebase's built-in flow
  (Authentication → Templates → Password reset in the console controls the
  email content/branding).
- Every password field has a show/hide (eye) toggle.
- Each account's role (admin/cashier) is stored in Firestore at
  stores/main/staff/{uid} and is what Firestore Security Rules check —
  so a cashier genuinely cannot delete/void bills or edit products, even
  by calling Firestore directly, not just because the button is hidden.
- Bills are never hard-deleted anymore. An admin can "Void" a bill, which
  keeps it visible (marked Voided, with a reason) for your records, and it
  is excluded from revenue totals.
- The Reports page now charts your real sales data (7-day revenue trend
  and revenue by category) instead of fixed placeholder numbers.

ONE-TIME FIREBASE CONSOLE SETUP
1. Authentication → Sign-in method → enable "Email/Password".
   (Turn OFF "Anonymous" if it was enabled before — it's no longer used.)
2. Firestore Database → Rules → paste the contents of firestore.rules and
   publish.
3. Create your first admin account:
   a. Authentication → Users → Add user → enter an email + password for
      yourself.
   b. Copy that user's UID.
   c. Firestore Database → Data → create the document:
        stores/main/staff/{the UID you copied}
      with fields:
        role  (string) = "admin"
        name  (string) = "Admin" (or your name)
   d. Repeat with role = "cashier" for each cashier account.
   There's no self-registration by design — anyone able to create their own
   account and grant themselves "admin" would defeat the whole point of
   admin-only permissions, so new staff accounts are added by an admin
   through the console (or ask about a small admin "create user" screen if
   you'd like one added later — it needs a tiny bit of backend logic since
   the client SDK can't create another user without signing out the admin).
4. Serve the folder with VS Code Live Server (or any static host — Firebase
   Auth needs HTTPS or localhost).

DATA MODEL
stores/main/staff/{uid}   — { role: "admin" | "cashier", name }
stores/main/products      — product catalog
stores/main/sales         — completed bills, with { voided, voidedBy,
                              voidedAt, voidReason } once an admin voids one

TROUBLESHOOTING
- If sign-in fails with "Your account isn't set up for SuperPOS yet", step
  3c above (the staff/{uid} document) is missing for that account.
- If edits/voids silently don't change anything, open the browser Console
  — a "permission-denied" error usually means firestore.rules hasn't been
  published yet, or the signed-in account's staff document has the wrong
  role.
- Local storage is only ever used for the theme (light/dark) preference —
  never for accounts, products, or sales.
