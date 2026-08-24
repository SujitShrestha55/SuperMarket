/* SuperPOS Firebase bridge.
   Firebase Authentication (email/password) is the single source of truth for
   sign-in — a password change or reset here updates the account everywhere,
   not just the current browser/device. Firestore (stores/main/staff/{uid})
   holds each account's role (admin/cashier); Firestore Security Rules are
   the real enforcement of "admin only" actions, not just hiding a button.
   Products and sales live in Firestore too — nothing business-critical is
   stored in localStorage. */
(() => {
  const cfg = window.SUPERPOS_FIREBASE;
  const disabled = !cfg?.enabled || !cfg?.config?.apiKey;

  function disabledApi(reason) {
    const fail = async () => { throw new Error(reason); };
    return {
      enabled: false,
      onAuthChange: () => () => {},
      signIn: fail,
      signOutUser: fail,
      sendPasswordReset: fail,
      changePassword: fail,
      getStaffProfile: fail,
      loadData: async () => null,
      startRealtime: () => () => {},
      addProduct: fail,
      updateProduct: fail,
      deleteProduct: fail,
      completeSale: fail,
      voidSale: fail
    };
  }

  if (disabled || !window.firebase) {
    window.superposFirebase = disabledApi("Firebase is not configured.");
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg.config);
    const app = firebase.app();
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storeRef = db.collection("stores").doc("main");
    const productsRef = storeRef.collection("products");
    const salesRef = storeRef.collection("sales");
    const staffRef = storeRef.collection("staff");

    const toProduct = d => ({ id: Number.isFinite(Number(d.id)) ? Number(d.id) : d.id, ...d.data() });
    const toSale = d => ({ id: d.id, ...d.data() });

    // --- Authentication -----------------------------------------------

    function onAuthChange(callback) {
      return auth.onAuthStateChanged(callback);
    }

    async function signIn(email, password) {
      const cred = await auth.signInWithEmailAndPassword(String(email || "").trim(), password);
      return cred.user;
    }

    async function signOutUser() {
      await auth.signOut();
    }

    // Uses Firebase's built-in password-reset email flow, so no custom
    // "verification code" storage or logic needs to be built or trusted.
    async function sendPasswordReset(email) {
      await auth.sendPasswordResetEmail(String(email || "").trim());
    }

    // Changes the account's password everywhere (all devices), not a
    // browser-local value — this is the fix for "password change only
    // works on this device".
    async function changePassword(currentPassword, newPassword) {
      const user = auth.currentUser;
      if (!user) throw new Error("You're signed out. Please log in again.");
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
    }

    async function getStaffProfile(uid) {
      const snap = await staffRef.doc(uid).get();
      if (!snap.exists) return null;
      return { uid, ...snap.data() };
    }

    // --- Products & sales ------------------------------------------------

    async function loadData() {
      const [ps, ss] = await Promise.all([productsRef.get(), salesRef.get()]);
      return {
        products: ps.docs.map(toProduct),
        sales: ss.docs.map(toSale).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      };
    }

    function startRealtime(onProducts, onSales, onError) {
      const unsubProducts = productsRef.onSnapshot(
        snap => onProducts(snap.docs.map(toProduct)),
        err => { console.error("Products realtime listener:", err); onError?.(err); }
      );
      const unsubSales = salesRef.onSnapshot(
        snap => onSales(snap.docs.map(toSale).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))),
        err => { console.error("Sales realtime listener:", err); onError?.(err); }
      );
      return () => { unsubProducts(); unsubSales(); };
    }

    async function nextProductId() {
      const snap = await productsRef.get();
      let max = 0;
      snap.forEach(d => {
        const n = Number(d.id ?? d.data().id ?? d.id);
        if (Number.isFinite(n)) max = Math.max(max, n);
      });
      return max + 1;
    }

    async function addProduct(product) {
      const id = await nextProductId();
      const data = {
        id,
        barcode: String(product.barcode || ""),
        name: String(product.name || ""),
        category: String(product.category || "General"),
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await productsRef.doc(String(id)).set(data);
      return { ...data, id };
    }

    async function updateProduct(id, product) {
      const data = {
        barcode: String(product.barcode || ""),
        name: String(product.name || ""),
        category: String(product.category || "General"),
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await productsRef.doc(String(id)).update(data);
      return { id: Number(id), ...data };
    }

    async function deleteProduct(id) {
      await productsRef.doc(String(id)).delete();
    }

    async function completeSale(sale) {
      const saleId = sale.invoice || `INV-${Date.now()}`;
      const saleRef = salesRef.doc(String(saleId));

      await db.runTransaction(async transaction => {
        const productRefs = sale.items.map(item => productsRef.doc(String(item.id)));
        const snapshots = [];
        for (const ref of productRefs) snapshots.push(await transaction.get(ref));

        snapshots.forEach((snap, index) => {
          if (!snap.exists) throw new Error(`Product ${sale.items[index].name} no longer exists.`);
        });

        snapshots.forEach((snap, index) => {
          const item = sale.items[index];
          const stock = Number(snap.data().stock || 0);
          if (stock < Number(item.qty)) {
            throw new Error(`Insufficient stock for ${item.name}. Available: ${stock}.`);
          }
        });

        snapshots.forEach((snap, index) => {
          const item = sale.items[index];
          transaction.update(productRefs[index], {
            stock: Number(snap.data().stock || 0) - Number(item.qty),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });

        transaction.set(saleRef, {
          invoice: saleId,
          date: sale.date || new Date().toISOString(),
          cashier: sale.cashier || "Staff",
          role: sale.role || "cashier",
          total: Number(sale.total || 0),
          voided: false,
          items: sale.items.map(x => ({
            id: x.id,
            name: x.name,
            price: Number(x.price || 0),
            qty: Number(x.qty || 0)
          })),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      return saleId;
    }

    // Bills are never hard-deleted: they're marked voided so there is
    // always an audit trail of who removed a bill and why. Firestore rules
    // also enforce that only an admin account can perform this update.
    async function voidSale(invoice, reason, voidedByName) {
      await salesRef.doc(String(invoice)).update({
        voided: true,
        voidedBy: voidedByName || "Admin",
        voidedAt: firebase.firestore.FieldValue.serverTimestamp(),
        voidReason: String(reason || "").trim() || "No reason given"
      });
    }

    window.superposFirebase = {
      enabled: true,
      app, auth, db,
      onAuthChange,
      signIn,
      signOutUser,
      sendPasswordReset,
      changePassword,
      getStaffProfile,
      loadData,
      startRealtime,
      addProduct,
      updateProduct,
      deleteProduct,
      completeSale,
      voidSale
    };

    console.log("SuperPOS Firebase connected:", cfg.config.projectId);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    window.superposFirebase = disabledApi(err.message || "Firebase failed to initialize.");
  }
})();
