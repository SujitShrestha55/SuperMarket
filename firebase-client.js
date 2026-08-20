/* SuperPOS Firebase bridge.
   Firestore is the source of truth for products and sales.
   The existing SuperPOS UI is unchanged. */
(() => {
  const cfg = window.SUPERPOS_FIREBASE;
  const disabled = !cfg?.enabled || !cfg?.config?.apiKey;

  if (disabled || !window.firebase) {
    window.superposFirebase = {
      enabled: false,
      ready: Promise.resolve(false),
      loadData: async () => null,
      startRealtime: () => () => {},
      addProduct: async () => { throw new Error("Firebase is not configured."); },
      updateProduct: async () => { throw new Error("Firebase is not configured."); },
      deleteProduct: async () => { throw new Error("Firebase is not configured."); },
      completeSale: async () => { throw new Error("Firebase is not configured."); }
    };
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

    const ready = auth.currentUser
      ? Promise.resolve(true)
      : auth.signInAnonymously().then(() => true);

    const toProduct = d => ({ id: Number.isFinite(Number(d.id)) ? Number(d.id) : d.id, ...d.data() });
    const toSale = d => ({ id: d.id, ...d.data() });

    async function loadData() {
      await ready;
      const [ps, ss] = await Promise.all([
        productsRef.get(),
        salesRef.get()
      ]);
      return {
        products: ps.docs.map(toProduct),
        sales: ss.docs.map(toSale).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0))
      };
    }

    function startRealtime(onProducts, onSales, onError) {
      let unsubProducts = () => {};
      let unsubSales = () => {};
      let stopped = false;

      ready.then(() => {
        if (stopped) return;
        unsubProducts = productsRef.onSnapshot(
          snap => onProducts(snap.docs.map(toProduct)),
          err => { console.error("Products realtime listener:", err); onError?.(err); }
        );
        unsubSales = salesRef.onSnapshot(
          snap => onSales(snap.docs.map(toSale).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0))),
          err => { console.error("Sales realtime listener:", err); onError?.(err); }
        );
      }).catch(err => { console.error("Firebase authentication:", err); onError?.(err); });

      return () => {
        stopped = true;
        unsubProducts();
        unsubSales();
      };
    }

    async function nextProductId() {
      await ready;
      const snap = await productsRef.get();
      let max = 0;
      snap.forEach(d => {
        const n = Number(d.id ?? d.data().id ?? d.id);
        if (Number.isFinite(n)) max = Math.max(max, n);
      });
      return max + 1;
    }

    async function addProduct(product) {
      await ready;
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
      await ready;
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
      await ready;
      await productsRef.doc(String(id)).delete();
    }

    async function completeSale(sale) {
      await ready;
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
          const current = snap.data();
          const stock = Number(current.stock || 0);
          if (stock < Number(item.qty)) {
            throw new Error(`Insufficient stock for ${item.name}. Available: ${stock}.`);
          }
        });

        snapshots.forEach((snap, index) => {
          const item = sale.items[index];
          const current = snap.data();
          transaction.update(productRefs[index], {
            stock: Number(current.stock || 0) - Number(item.qty),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });

        transaction.set(saleRef, {
          invoice: saleId,
          date: sale.date || new Date().toISOString(),
          cashier: sale.cashier || "Admin",
          role: sale.role || "cashier",
          total: Number(sale.total || 0),
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

    window.superposFirebase = {
      enabled: true,
      app, auth, db, ready,
      loadData,
      startRealtime,
      addProduct,
      updateProduct,
      deleteProduct,
      completeSale
    };

    console.log("SuperPOS Firebase connected:", cfg.config.projectId);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    window.superposFirebase = {
      enabled: false,
      ready: Promise.resolve(false),
      loadData: async () => null,
      startRealtime: () => () => {},
      addProduct: async () => { throw err; },
      updateProduct: async () => { throw err; },
      deleteProduct: async () => { throw err; },
      completeSale: async () => { throw err; }
    };
  }
})();
