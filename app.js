// ============================================================
// SuperPOS — persistent vanilla HTML/CSS/JS POS
// ============================================================

const initialProducts = [
  { id: 1, barcode: "8901234567890", name: "Coca Cola 500ml", category: "Drinks", price: 60, stock: 42 },
  { id: 2, barcode: "8901234567891", name: "Lays Classic", category: "Snacks", price: 50, stock: 18 },
  { id: 3, barcode: "8901234567892", name: "Milk 1L", category: "Dairy", price: 95, stock: 7 },
  { id: 4, barcode: "8901234567893", name: "Basmati Rice 5kg", category: "Grocery", price: 850, stock: 25 },
  { id: 5, barcode: "8901234567894", name: "Noodles", category: "Grocery", price: 45, stock: 63 },
  { id: 6, barcode: "8901234567895", name: "Chocolate Bar", category: "Snacks", price: 80, stock: 4 }
];

const money = n => "Rs. " + Number(n || 0).toLocaleString("en-IN");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => Date.now() + Math.floor(Math.random() * 1000);
const STORAGE = "superpos-v2";
let firebaseSyncTimer = null;
let firebaseDataReady = false;

const NAV = [
  { name: "Dashboard", icon: "layout-dashboard" },
  { name: "Point of Sale", icon: "shopping-cart" },
  { name: "Inventory", icon: "package" },
  { name: "Sales", icon: "receipt-text" },
  { name: "Reports", icon: "bar-chart-3" },
  { name: "Settings", icon: "settings" }
];

const state = {
  page: "Dashboard",
  dark: true,
  sidebarOpen: false,
  products: [],
  cart: [],
  search: "",
  barcode: "",
  inventorySearch: "",
  sales: [],
  user: null,
  role: "admin",
  modal: null
};

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const icon = (name, size = 18) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
function refreshIcons(){ if(window.lucide) window.lucide.createIcons(); }

function saveState(){
  // Products and sales are NEVER persisted to localStorage.
  // Firebase/Firestore is the single source of truth.
  localStorage.setItem(STORAGE, JSON.stringify({
    dark: state.dark,
    user: state.user,
    role: state.role
  }));
}

function firebaseStatus(){
  return window.superposFirebase?.enabled ? "Connected to Firebase" : "Firebase unavailable";
}

function scheduleFirebaseSync(){ /* intentionally unused: Firestore writes are explicit */ }

let stopFirebaseRealtime = null;

async function initializeFirebaseData(){
  const fb=window.superposFirebase;
  if(!fb?.enabled){
    firebaseDataReady=false;
    throw new Error("Firebase is not available. Products and sales require Firebase.");
  }

  await fb.ready;

  // Seed the Firestore database only when it is genuinely empty.
  const remote=await fb.loadData();
  if(!remote) throw new Error("Could not read Firestore.");

  if(!remote.products.length){
    for(const p of initialProducts) await fb.addProduct(p);
  }

  stopFirebaseRealtime = fb.startRealtime(
    products => {
      state.products = products.sort((a,b)=>Number(a.id)-Number(b.id));
      firebaseDataReady=true;
      renderPage();
    },
    sales => {
      state.sales = sales;
      firebaseDataReady=true;
      renderPage();
    },
    err => {
      console.error("Firebase realtime error:",err);
      showToast("Firebase realtime connection error.");
    }
  );

  // If listeners haven't fired yet, use the initial read.
  state.products=remote.products;
  state.sales=remote.sales;
  firebaseDataReady=true;
}

function loadState(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    // Only UI/session preferences are local. Products and sales always come from Firebase.
    state.products = [];
    state.sales = [];
    state.dark = raw.dark !== false;
    state.user = raw.user || null;
    state.role = raw.role || state.user?.role || "admin";
  }catch(e){
    state.products = [];
    state.sales = [];
    state.dark = true;
    state.role = "admin";
  }
}
function applyTheme(){
  $("#appRoot").className = state.dark ? "app dark" : "app";
  const b = $("#themeToggleBtn");
  if(b) b.innerHTML = icon(state.dark ? "sun" : "moon",18);
  refreshIcons();
}
function formatDateTime(value){
  return new Date(value).toLocaleString("en-NP",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function updateDate(){
  const el=$("#todayDate");
  if(el) el.textContent=new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  const context=$("#headerContext");
  if(context){
    const info={
      "Dashboard":["DASHBOARD","Store overview"],
      "Point of Sale":["POINT OF SALE","New transaction"],
      "Inventory":["INVENTORY","Products & stock"],
      "Sales":["SALES HISTORY","Completed bills"],
      "Reports":["REPORTS","Performance"],
      "Settings":["SETTINGS","System controls"]
    }[state.page] || ["SUPERPOS","Management Suite"];
    context.innerHTML=`<span>${esc(info[0])}</span><b>${esc(info[1])}</b>`;
  }
}
function currentUserName(){ return state.user?.name || "Admin"; }
function currentRole(){ return state.role || state.user?.role || "admin"; }
function isAdmin(){ return currentRole()==="admin"; }
function roleLabel(){ return isAdmin()?"Administrator":"Cashier"; }
function allowedNav(){ return isAdmin()?NAV:NAV.filter(n=>["Dashboard","Point of Sale","Sales"].includes(n.name)); }

function filteredPOS(){
  const s=state.search.trim().toLowerCase();
  return !s ? state.products : state.products.filter(p=>[p.name,p.category,p.barcode].some(v=>String(v).toLowerCase().includes(s)));
}
function filteredInventory(){
  const s=state.inventorySearch.trim().toLowerCase();
  return !s ? state.products : state.products.filter(p=>[p.name,p.category,p.barcode].some(v=>String(v).toLowerCase().includes(s)));
}

function headHtml(eyebrow,title,sub,actions=""){
  return `<div class="pageHead"><div><small>${esc(eyebrow)}</small><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${actions}</div>`;
}
function statHtml(title,value,change,iconName){
  return `<div class="stat"><div class="statIcon">${icon(iconName,19)}</div><p>${esc(title)}</p><h2>${esc(value)}</h2><span>${icon("arrow-up-right",13)}${esc(change)}</span></div>`;
}

function renderDashboard(){
  const low=state.products.filter(p=>p.stock<=7);
  const today=state.sales.filter(s=>new Date(s.date).toDateString()===new Date().toDateString());
  const todayTotal=today.reduce((a,s)=>a+s.total,0);
  const monthSales=state.sales.filter(s=>new Date(s.date).getMonth()===new Date().getMonth()).reduce((a,s)=>a+s.total,0);
  return `${headHtml("DASHBOARD",`Good morning, ${currentUserName()} 👋`,"Here's what's happening with your store today.",
    `<button class="primary" id="dashOpenPos">${icon("shopping-cart",16)} Open POS</button>`)}
    <div class="stats">
      ${statHtml("Today's Sales",money(todayTotal),`${today.length} completed`,"receipt-text")}
      ${statHtml("Orders",String(today.length),"+ today","shopping-cart")}
      ${statHtml("Products",String(state.products.length),"in inventory","package")}
      ${statHtml("Monthly Sales",money(monthSales),"current month","trending-up")}
    </div>
    <div class="two">
      <div class="panel"><div class="panelHead"><div><h2>Sales Overview</h2><p>Recent transaction activity</p></div><button class="link" id="dashViewSales">View all</button></div>
      <div class="chart">${[38,55,42,70,62,88,76,96,80,92,72,86].map((h,i)=>`<div class="barWrap"><div class="bar" style="height:${h}%"></div><span>${["M","T","W","T","F","S"][i%6]}</span></div>`).join("")}</div></div>
      <div class="panel"><div class="panelHead"><div><h2>Low Stock</h2><p>Products needing attention</p></div><button class="link" id="dashViewInventory">View all</button></div>
      ${low.length?low.slice(0,6).map(p=>`<div class="stock"><div class="mini">${esc(p.name[0])}</div><div><b>${esc(p.name)}</b><span>${esc(p.category)}</span></div><strong class="${p.stock<=4?"danger":"warn"}">${p.stock} left</strong></div>`).join(""):`<div class="empty" style="height:180px">All products have healthy stock.</div>`}</div>
    </div>
    <div class="panel tablePanel"><div class="panelHead"><div><h2>Recent Transactions</h2><p>Your latest sales activity</p></div><button class="link" id="dashViewSales2">View all</button></div>${salesTableHtml(state.sales.slice(0,5))}</div>`;
}

function posProductsGridHtml(){
  const products=filteredPOS();
  if(!products.length)return `<div class="searchResultsEmpty">No products match your search.</div>`;
  return products.map(p=>`<button class="product" data-id="${p.id}" ${p.stock<=0?"disabled":""}>
    <div class="productImg">${esc(p.name[0])}</div><b>${esc(p.name)}</b><span>${esc(p.category)}</span><strong>${money(p.price)}</strong><small>${p.stock} in stock</small>${icon("plus",17)}
  </button>`).join("");
}
function cartPanelInnerHtml(){
  const total=state.cart.reduce((s,x)=>s+x.price*x.qty,0);
  const count=state.cart.reduce((s,x)=>s+x.qty,0);
  const items=!state.cart.length?`<div class="empty">${icon("shopping-cart",40)}<b>Your cart is empty</b><span>Scan or select a product to begin.</span></div>`:
    state.cart.map(x=>`<div class="cartItem"><div class="mini">${esc(x.name[0])}</div><div class="cartInfo"><b>${esc(x.name)}</b><span>${money(x.price)}</span><div class="qty"><button class="qtyDown" data-id="${x.id}">${icon("minus",12)}</button><b>${x.qty}</b><button class="qtyUp" data-id="${x.id}">${icon("plus",12)}</button></div></div><strong>${money(x.price*x.qty)}</strong><button class="remove" data-id="${x.id}">${icon("trash-2",14)}</button></div>`).join("");
  return `<div class="panelHead"><div><h2>Current Order</h2><p>${count} items</p></div><button class="clear" id="cartClearBtn">Clear</button></div><div class="cartItems">${items}</div><div class="checkout"><div class="grand"><span>Total</span><strong>${money(total)}</strong></div><button class="checkoutBtn" id="checkoutBtn" ${!state.cart.length?"disabled":""}>Complete Sale ${icon("arrow-up-right",17)}</button></div>`;
}
function renderPOS(){
  const count=state.cart.reduce((s,x)=>s+x.qty,0);
  // Page context is already shown in the global header, so keep the POS workspace
  // focused on scanning, products, the current order, and completing the sale.
  return `<div class="pos"><div class="panel">
      <div class="scan">${icon("barcode",20)}<input id="barcodeInput" autofocus placeholder="Scan barcode here..." value="${esc(state.barcode)}"/><kbd>ENTER</kbd><button class="camBtn" id="cameraScanBtn" title="Scan with camera">${icon("camera",17)}</button></div>
      <div class="search">${icon("search",16)}<input id="posSearchInput" placeholder="Search products in inventory..." value="${esc(state.search)}"/></div>
      <div class="products" id="posProductsGrid">${posProductsGridHtml()}</div>
    </div>
    <div class="panel cart" id="cartPanel">${cartPanelInnerHtml()}</div></div>
    <button class="cartFab" id="cartFab">${icon("shopping-cart",18)} Cart <span class="cartCount">${count}</span></button>`;
}

function renderInventory(){
  const products=filteredInventory();
  return `${headHtml("INVENTORY","Products","Add, edit, restock or remove products.",
    `<div class="inventoryToolbar"><div class="search inventorySearch">${icon("search",15)}<input id="inventorySearchInput" placeholder="Search inventory..." value="${esc(state.inventorySearch)}"/></div><button class="secondaryBtn" id="invScanBtn">${icon("camera",16)} Scan</button><button class="primary" id="invAddBtn">${icon("plus",16)} Add Product</button></div>`)}
    <div class="panel tablePanel scrollPanel"><div class="panelHead"><div><h2>Product Inventory</h2><p>${products.length} products shown</p></div></div>
    <div class="tableWrap"><table><thead><tr><th>PRODUCT</th><th>BARCODE</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
    ${products.map(p=>`<tr><td><div class="productCell"><b>${esc(p.name)}</b></div></td><td class="mono">${esc(p.barcode)}</td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><span class="status ${p.stock<=7?"warningStatus":""}">${p.stock<=7?"Low stock":"In stock"}</span></td><td><div class="rowActions"><button class="rowBtn edit" data-edit="${p.id}" title="Edit">${icon("pencil",14)}</button><button class="rowBtn delete" data-delete="${p.id}" title="Delete">${icon("trash-2",14)}</button></div></td></tr>`).join("")}
    </tbody></table></div></div>`;
}

function salesTableHtml(sales){
  if(!sales.length)return `<div class="salesEmpty">${icon("receipt",35)}<p>No completed bills yet.</p></div>`;
  return `<div class="tableWrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>CASHIER</th><th>ITEMS</th><th>TOTAL</th><th>ACTION</th></tr></thead><tbody>
  ${sales.map(s=>`<tr><td class="invoiceId">${esc(s.invoice)}</td><td>${esc(formatDateTime(s.date))}</td><td>${esc(s.cashier)}</td><td>${s.items.reduce((a,i)=>a+i.qty,0)}</td><td>${money(s.total)}</td><td><div class="invoiceActions"><button class="rowBtn edit" data-view-invoice="${esc(s.invoice)}" title="View bill">${icon("eye",14)}</button><button class="rowBtn" data-print-invoice="${esc(s.invoice)}" title="Print bill">${icon("printer",14)}</button></div></td></tr>`).join("")}
  </tbody></table></div>`;
}
function renderSales(){
  return `${headHtml("SALES","Sales History","View, print and reprint every completed bill.",
    `<button class="secondaryBtn" id="salesRefreshBtn">${icon("refresh-cw",15)} Refresh</button>`)}
    <div class="panel tablePanel scrollPanel"><div class="panelHead"><div><h2>Past Bills</h2><p>${state.sales.length} saved transaction${state.sales.length===1?"":"s"}</p></div></div>${salesTableHtml(state.sales)}</div>`;
}
function renderReports(){
  const total=state.sales.reduce((a,s)=>a+s.total,0);
  const items=state.sales.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty,0),0);
  return `${headHtml("ANALYTICS","Reports","Understand your store performance.")}<div class="stats">${statHtml("Total Revenue",money(total),"all saved sales","bar-chart-3")}${statHtml("Gross Profit",money(Math.round(total*.25)),"estimated","trending-up")}${statHtml("Orders",String(state.sales.length),"completed","shopping-cart")}${statHtml("Items Sold",String(items),"all sales","receipt-text")}</div><div class="panel"><div class="panelHead"><div><h2>Monthly Performance</h2><p>Revenue trend</p></div></div><div class="bigChart">${[35,42,38,60,52,70,65,82,74,90,78,96].map((h,i)=>`<div class="barWrap"><div class="bar" style="height:${h}%"></div><span>${i+1}</span></div>`).join("")}</div></div>`;
}
function renderSettings(){
  return `${headHtml("SYSTEM","Settings","Store preferences and account controls.")}<div class="settings">
  <div class="panel setting">${icon("shield-check",22)}<h2>Security</h2><p>This version includes a local login and persistent browser storage. For multi-user production use, connect a real authentication/database service.</p><button id="changePasswordBtn">Change password</button></div>
  <div class="panel setting">${icon("database",22)}<h2>Data</h2><p>${esc(firebaseStatus())}. Products and completed bills are synchronized when Firebase is configured; local storage remains as an offline fallback.</p><button id="resetDemoBtn">Reset demo data</button></div>
  <div class="panel setting">${icon("user-round",22)}<h2>Account</h2><p>Signed in as ${esc(currentUserName())}. Log out from the sidebar when needed.</p><button id="settingsLogoutBtn">Log out</button></div>
  </div>`;
}

function renderPage(){
  document.body.classList.toggle("posMode",state.page==="Point of Sale");
  document.body.classList.toggle("adminMode",isAdmin());
  document.body.classList.toggle("cashierMode",!isAdmin());
  const content=$("#content"); if(!content)return;
  switch(state.page){
    case "Dashboard":content.innerHTML=renderDashboard();break;
    case "Point of Sale":content.innerHTML=renderPOS();break;
    case "Inventory":content.innerHTML=renderInventory();break;
    case "Sales":content.innerHTML=renderSales();break;
    case "Reports":content.innerHTML=renderReports();break;
    case "Settings":content.innerHTML=renderSettings();break;
  }
  renderNav();
  attachContentListeners();
  updateDate();
  refreshIcons();
}
function renderNav(){
  const allowed=allowedNav();
  $("#navList").innerHTML=allowed.map(n=>`<button class="nav ${state.page===n.name?"active":""}" data-page="${n.name}">${icon(n.icon,18)} ${n.name}</button>`).join("");
  $$("#navList .nav").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
  refreshIcons();
}
function setPage(name,updateHash=true){
  if(!allowedNav().some(n=>n.name===name)) name=isAdmin()?"Dashboard":"Point of Sale";
  state.page=name;state.sidebarOpen=false;$("#sidebar").classList.remove("open");
  if(updateHash) location.hash=encodeURIComponent(name);
  renderPage();
}
function pageFromHash(){
  const raw=decodeURIComponent(location.hash.replace(/^#/,""));
  return allowedNav().some(n=>n.name===raw)?raw:(isAdmin()?"Dashboard":"Point of Sale");
}

function renderPOSGridOnly(){
  const g=$("#posProductsGrid");if(!g)return;
  g.innerHTML=posProductsGridHtml();attachProductGridListeners();refreshIcons();
}
function renderCartPanelOnly(){
  const p=$("#cartPanel");if(!p)return;
  p.innerHTML=cartPanelInnerHtml();attachCartListeners();refreshIcons();
  const fab=$("#cartFab");if(fab)fab.querySelector(".cartCount").textContent=state.cart.reduce((s,x)=>s+x.qty,0);
}
function openMobileCart(){
  const existing=$("#cartModal");
  if(existing)existing.remove();
  const div=document.createElement("div");div.id="cartModal";div.className="uiModal open";
  div.innerHTML=`<div class="uiModalCard"><div class="modalHead"><div><h3>Current Order</h3><p>Review items before checkout</p></div><button class="modalClose" id="closeCartModal">${icon("x",16)}</button></div><div id="mobileCartInner">${cartPanelInnerHtml()}</div></div>`;
  document.body.appendChild(div);
  document.body.classList.add("cartModalOpen");
  refreshIcons();
  $("#closeCartModal").onclick=()=>{div.remove();document.body.classList.remove("cartModalOpen")};
  attachCartListeners(div);
}
function attachCartListeners(root=document){
  const scope=root;
  scope.querySelectorAll(".qtyUp").forEach(b=>b.onclick=()=>adjustQty(Number(b.dataset.id),1));
  scope.querySelectorAll(".qtyDown").forEach(b=>b.onclick=()=>adjustQty(Number(b.dataset.id),-1));
  scope.querySelectorAll(".remove").forEach(b=>b.onclick=()=>removeFromCart(Number(b.dataset.id)));
  const clear=scope.querySelector("#cartClearBtn");if(clear)clear.onclick=clearCart;
  const checkoutBtn=scope.querySelector("#checkoutBtn");if(checkoutBtn)checkoutBtn.onclick=checkout;
}
function refreshMobileCart(){
  const modal=$("#cartModal");if(modal){
    const inner=modal.querySelector("#mobileCartInner");if(inner){inner.innerHTML=cartPanelInnerHtml();attachCartListeners(modal);refreshIcons();}
  }
  renderCartPanelOnly();
}

function attachProductGridListeners(){
  $$("#posProductsGrid .product").forEach(b=>b.onclick=()=>addToCart(Number(b.dataset.id)));
}
function attachContentListeners(){
  const openPos=$("#dashOpenPos");if(openPos)openPos.onclick=()=>setPage("Point of Sale");
  const inv=$("#dashViewInventory");if(inv)inv.onclick=()=>setPage("Inventory");
  const sales=$("#dashViewSales");if(sales)sales.onclick=()=>setPage("Sales");
  const sales2=$("#dashViewSales2");if(sales2)sales2.onclick=()=>setPage("Sales");

  if(state.page==="Point of Sale"){
    attachProductGridListeners();attachCartListeners();
    const barcode=$("#barcodeInput");
    if(barcode){
      barcode.oninput=e=>state.barcode=e.target.value;
      barcode.onkeydown=e=>{if(e.key==="Enter"){scanBarcode(state.barcode);state.barcode="";barcode.value="";}};
    }
    const search=$("#posSearchInput");
    if(search){search.oninput=e=>{state.search=e.target.value;renderPOSGridOnly();};}
    const cam=$("#cameraScanBtn");if(cam)cam.onclick=()=>openCameraScanner("pos");
    const fab=$("#cartFab");if(fab)fab.onclick=openMobileCart;
  }
  if(state.page==="Inventory"){
    const search=$("#inventorySearchInput");if(search)search.oninput=e=>{state.inventorySearch=e.target.value;renderPage();setTimeout(()=>{const el=$("#inventorySearchInput");if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},0);};
    const add=$("#invAddBtn");if(add)add.onclick=()=>openProductModal();
    const scan=$("#invScanBtn");if(scan)scan.onclick=()=>openCameraScanner("inventory");
    $$("[data-edit]").forEach(b=>b.onclick=()=>openProductModal(Number(b.dataset.edit)));
    $$("[data-delete]").forEach(b=>b.onclick=()=>confirmDelete(Number(b.dataset.delete)));
  }
  if(state.page==="Sales"){
    const r=$("#salesRefreshBtn");if(r)r.onclick=()=>renderPage();
    $$("[data-view-invoice]").forEach(b=>b.onclick=()=>showInvoice(b.dataset.viewInvoice));
    $$("[data-print-invoice]").forEach(b=>b.onclick=()=>printInvoice(b.dataset.printInvoice));
  }
  if(state.page==="Settings"){
    const cp=$("#changePasswordBtn");if(cp)cp.onclick=openChangePassword;
    const reset=$("#resetDemoBtn");if(reset)reset.onclick=resetDemoData;
    const lo=$("#settingsLogoutBtn");if(lo)lo.onclick=logout;
  }
}

function addToCart(id){
  const p=state.products.find(x=>x.id===id);if(!p||p.stock<=0)return;
  const x=state.cart.find(c=>c.id===id);
  if(x){if(x.qty<p.stock)x.qty++;else showToast("Not enough stock.");}
  else state.cart.push({id:p.id,name:p.name,price:p.price,stock:p.stock,qty:1});
  renderCartPanelOnly();refreshMobileCart();
}
function adjustQty(id,delta){
  const p=state.products.find(x=>x.id===id);
  state.cart=state.cart.flatMap(x=>x.id!==id?[x]:[{...x,qty:Math.max(0,Math.min(p?.stock||0,x.qty+delta))}]).filter(x=>x.qty>0);
  renderCartPanelOnly();refreshMobileCart();
}
function removeFromCart(id){state.cart=state.cart.filter(x=>x.id!==id);renderCartPanelOnly();refreshMobileCart();}
function clearCart(){state.cart=[];renderCartPanelOnly();refreshMobileCart();}
function scanBarcode(code){
  const t=(code||"").trim();if(!t)return;
  const p=state.products.find(x=>x.barcode===t);
  if(p)addToCart(p.id);else showToast("Product not found. Add it in Inventory first.");
}

async function checkout(){
  if(!state.cart.length)return;
  const items=state.cart.map(x=>({...x}));
  const total=items.reduce((s,x)=>s+x.price*x.qty,0);
  const sale={
    role:currentRole(),
    invoice:`INV-${Date.now()}`,
    date:new Date().toISOString(),
    cashier:currentUserName(),
    items,
    total
  };

  const btn=$("#checkoutBtn");
  if(btn){btn.disabled=true;btn.textContent="Saving…";}

  try{
    await window.superposFirebase.completeSale(sale);
    state.cart=[];
    const mobileCart=$("#cartModal");
    if(mobileCart) mobileCart.remove();
    document.body.classList.remove("cartModalOpen");
    renderPage();
    showToast("Sale saved to Firebase.");
    showInvoice(sale,true);
  }catch(err){
    console.error("Firebase checkout failed:",err);
    showToast(err.message || "Could not complete sale.");
    renderPage();
  }
}

function invoiceHtml(sale){
  return `<div class="invoicePreview" id="invoicePrintArea">
    <div style="display:flex;justify-content:space-between;gap:15px"><div><h2>SuperPOS</h2></div><div style="text-align:right"><b>${esc(sale.invoice)}</b><p>${esc(formatDateTime(sale.date))}</p></div></div>
    <hr style="border:0;border-top:1px solid #ddd;margin:14px 0">
    <p>Cashier: <b>${esc(sale.cashier)}</b></p>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${sale.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.price*i.qty)}</td></tr>`).join("")}</tbody></table>
    <div class="invoiceTotal">TOTAL: ${money(sale.total)}</div><p style="text-align:center;margin-top:20px">Thank you for shopping with us.</p>
  </div>`;
}
function showInvoice(invoiceOrSale,afterSale=false){
  // After checkout the realtime sales listener may not have delivered the new sale yet.
  // Accept the freshly-created sale object directly so the bill popup always opens.
  const sale=typeof invoiceOrSale === "object"
    ? invoiceOrSale
    : state.sales.find(s=>s.invoice===invoiceOrSale);
  if(!sale)return;
  const invoice=String(sale.invoice || "");
  openModal(`<div class="modalHead"><div><h3>${esc(invoice)}</h3><p>${afterSale ? "Sale completed — bill preview" : "Bill preview"}</p></div><button class="modalClose" id="closeInvoice">${icon("x",16)}</button></div>${invoiceHtml(sale)}<div class="modalFooter"><button class="secondaryBtn" id="invoiceClose">Close</button><button class="primary" id="invoicePrint">${icon("printer",15)} Print Bill</button></div>`,true);
  $("#closeInvoice").onclick=closeModal;
  $("#invoiceClose").onclick=closeModal;
  $("#invoicePrint").onclick=()=>printInvoice(sale);
}
function printInvoice(invoiceOrSale){
  const sale=typeof invoiceOrSale === "object"
    ? invoiceOrSale
    : state.sales.find(s=>s.invoice===invoiceOrSale);
  if(!sale)return;
  const w=window.open("","_blank","width=720,height=800");
  if(!w){showToast("Please allow pop-ups to print the bill.");return;}
  w.document.write(`<!doctype html><html><head><title>${esc(sale.invoice)}</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111}h2{margin:0}p{font-size:12px;color:#555}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;font-size:12px}.total{text-align:right;font-size:18px;font-weight:700;margin-top:18px}@media print{button{display:none}}</style></head><body>${invoiceHtml(sale)}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
}

function openProductModal(id=null,initialBarcode=""){
  const p=id?state.products.find(x=>x.id===id):null;
  const barcodeValue=p?.barcode || initialBarcode;
  openModal(`<div class="modalHead"><div><h3>${p?"Edit Product":"Add Product"}</h3><p>${p?"Update product details and stock.":"Create a new inventory item."}</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div>
  <form id="productForm" class="modalForm">
    <div class="field"><label>Product name</label><input name="name" required value="${esc(p?.name||"")}" placeholder="e.g. Coca Cola 500ml"></div>
    <div class="field"><label>Barcode</label><input name="barcode" required value="${esc(barcodeValue)}" placeholder="Scan or type barcode"></div>
    <div class="field"><label>Category</label><input name="category" required value="${esc(p?.category||"General")}" placeholder="Drinks, Snacks..."></div>
    <div class="field"><label>Selling price (Rs.)</label><input name="price" type="number" min="0" step="0.01" required value="${p?.price??""}"></div>
    <div class="field full"><label>Stock quantity</label><input name="stock" type="number" min="0" step="1" required value="${p?.stock??0}"></div>
    <div class="modalFooter full"><button type="button" class="secondaryBtn" id="modalCancel">Cancel</button><button class="primary" type="submit">${p?"Save Changes":"Add Product"}</button></div>
  </form>`,false);
  $("#modalCloseBtn").onclick=closeModal;$("#modalCancel").onclick=closeModal;
  $("#productForm").onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const product={name:String(fd.get("name")).trim(),barcode:String(fd.get("barcode")).trim(),category:String(fd.get("category")).trim(),price:Number(fd.get("price")),stock:Number(fd.get("stock"))};
    if(!product.name||!product.barcode||!product.category||product.price<0||product.stock<0)return showToast("Please enter valid product details.");
    const duplicate=state.products.find(x=>x.barcode===product.barcode&&x.id!==id);
    if(duplicate)return showToast("That barcode is already used by another product.");
    const submitBtn=e.target.querySelector('button[type="submit"]');
    if(submitBtn)submitBtn.disabled=true;
    try{
      if(p) await window.superposFirebase.updateProduct(id,product);
      else await window.superposFirebase.addProduct(product);
      closeModal();
      showToast(p?"Product updated in Firebase.":"Product added to Firebase.");
    }catch(err){
      console.error("Product save failed:",err);
      showToast(err.message || "Could not save product.");
    }finally{
      if(submitBtn)submitBtn.disabled=false;
    }
  };
}
function confirmDelete(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  openModal(`<div class="modalHead"><div><h3>Delete product?</h3><p>This cannot be undone.</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div><p class="confirmText">Remove <b>${esc(p.name)}</b> from inventory? Existing saved bills will not be changed.</p><div class="modalFooter"><button class="secondaryBtn" id="modalCancel">Cancel</button><button class="dangerBtn" id="confirmDeleteBtn">${icon("trash-2",15)} Delete Product</button></div>`);
  $("#modalCloseBtn").onclick=closeModal;
  $("#modalCancel").onclick=closeModal;
  $("#confirmDeleteBtn").onclick=async()=>{
    const btn=$("#confirmDeleteBtn"); btn.disabled=true;
    try{
      await window.superposFirebase.deleteProduct(id);
      state.cart=state.cart.filter(x=>x.id!==id);
      closeModal();
      showToast("Product deleted from Firebase.");
    }catch(err){
      console.error("Product delete failed:",err);
      showToast(err.message || "Could not delete product.");
    }finally{btn.disabled=false;}
  };
}
function openChangePassword(){
  openModal(`<div class="modalHead"><div><h3>Change password</h3><p>Update the local demo account password.</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div>
  <form id="passwordForm"><div class="field"><label>Current password</label><input name="current" type="password" required></div><div class="field"><label>New password</label><input name="next" type="password" minlength="4" required></div><div class="modalFooter"><button type="button" class="secondaryBtn" id="modalCancel">Cancel</button><button class="primary">Update Password</button></div></form>`);
  $("#modalCloseBtn").onclick=closeModal;$("#modalCancel").onclick=closeModal;
  $("#passwordForm").onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);const users=getUsers();const u=users.find(x=>x.username===state.user.username);if(!u||u.password!==fd.get("current"))return showToast("Current password is incorrect.");u.password=String(fd.get("next"));localStorage.setItem("superpos-users",JSON.stringify(users));closeModal();showToast("Password changed.");};
}
function openModal(html,wide=false){const m=$("#uiModal");const c=$("#uiModalCard");c.className=`uiModalCard${wide?" wide":""}`;c.innerHTML=html;m.classList.add("open");m.setAttribute("aria-hidden","false");refreshIcons();}
function closeModal(){const m=$("#uiModal");m.classList.remove("open");m.setAttribute("aria-hidden","true");$("#uiModalCard").innerHTML="";}

function showToast(message){
  let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.style.cssText="position:fixed;right:18px;bottom:18px;z-index:3000;padding:12px 15px;border:1px solid var(--border);background:#12182fee;color:#fff;border-radius:11px;font-size:11px;box-shadow:0 15px 40px #0008;opacity:0;transform:translateY(8px);transition:.2s";document.body.appendChild(t);}
  t.textContent=message;t.style.opacity="1";t.style.transform="translateY(0)";clearTimeout(t._timer);t._timer=setTimeout(()=>{t.style.opacity="0";t.style.transform="translateY(8px)"},2600);
}

function getUsers(){
  try{return JSON.parse(localStorage.getItem("superpos-users")||"[]");}catch{return [];}
}
function ensureUsers(){
  let users=getUsers();
  if(!users.length){users=[{username:"admin",password:"admin123",name:"Admin",role:"admin"},{username:"cashier",password:"cashier123",name:"Cashier",role:"cashier"}];localStorage.setItem("superpos-users",JSON.stringify(users));}
  if(!users.some(u=>u.username==="cashier")){users.push({username:"cashier",password:"cashier123",name:"Cashier",role:"cashier"});localStorage.setItem("superpos-users",JSON.stringify(users));}
  if(!users.some(u=>u.username==="admin")){users.push({username:"admin",password:"admin123",name:"Admin",role:"admin"});localStorage.setItem("superpos-users",JSON.stringify(users));}
}
function renderLogin(){
  $("#loginScreen").innerHTML=`<div class="loginCard"><div class="loginBrand"><div class="brandIcon">${icon("shopping-cart",21)}</div><div><b>SuperPOS</b><span>Inventory System</span></div></div><h1>Welcome back</h1><p>Sign in with your role to continue to your store.</p><form id="loginForm"><div class="field"><label>Username</label><input name="username" autocomplete="username" required placeholder="admin"></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></div><div class="loginError" id="loginError"></div><button class="primary" style="width:100%">Sign in</button></form><div class="loginHint">Admin: <b>admin</b> / <b>admin123</b><br>Cashier: <b>cashier</b> / <b>cashier123</b></div></div>`;
  $("#loginForm").onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);const u=getUsers().find(x=>x.username===String(fd.get("username")).trim()&&x.password===String(fd.get("password")));if(!u){$("#loginError").textContent="Incorrect username or password.";return;}state.user={username:u.username,name:u.name,role:u.role||"admin"};state.role=u.role||"admin";saveState();showApp();};
  refreshIcons();
}
function showLogin(){stopCameraScan();$("#appShell").style.display="none";$("#loginScreen").classList.add("show");renderLogin();}
function showApp(){
  $("#loginScreen").classList.remove("show");$("#appShell").style.display="block";
  $("#sidebarUserName").textContent=currentUserName();$("#sidebarAvatar").textContent=currentUserName()[0]?.toUpperCase()||"A";$("#topAvatar").textContent=currentUserName()[0]?.toUpperCase()||"A";
  const roleNode=$("#sidebarUserName")?.parentElement?.querySelector("span"); if(roleNode) roleNode.innerHTML=`${icon(isAdmin()?"shield-check":"badge-check",11)} ${roleLabel()}`;
  const mobileTitle=$("#mobileTitle"); if(mobileTitle) mobileTitle.textContent=isAdmin()?"SuperPOS":"Cashier POS";
  applyTheme();setPage(pageFromHash(),false);
}
function logout(){state.user=null;state.cart=[];saveState();showLogin();}
async function resetDemoData(){
  showToast("Reset demo data is disabled here because Firebase is the source of truth.");
}

let zxingReader=null,scanControls=null,scanMode="pos",scanLocked=false;
function openCameraScanner(mode="pos"){
  scanMode=mode;scanLocked=false;const modal=$("#scanModal");$("#scanModalTitle").textContent=mode==="inventory"?"Scan barcode to add/restock":"Scan barcode with camera";$("#scanStatus").className="scanStatus";$("#scanStatus").textContent="Requesting camera access…";$("#scanRetryBtn").classList.remove("show");modal.classList.add("open");startCameraScan();
}
function closeCameraScanner(){stopCameraScan();$("#scanModal").classList.remove("open");}
async function startCameraScan(){
  const status=$("#scanStatus"),retry=$("#scanRetryBtn"),video=$("#scanVideo");
  if(!window.isSecureContext){status.className="scanStatus err";status.textContent="Camera requires HTTPS or localhost.";retry.classList.add("show");return;}
  if(!navigator.mediaDevices?.getUserMedia){status.className="scanStatus err";status.textContent="This browser does not support camera access.";retry.classList.add("show");return;}
  if(!window.ZXing){status.className="scanStatus err";status.textContent="Barcode library failed to load.";retry.classList.add("show");return;}
  try{
    if(!zxingReader)zxingReader=new ZXing.BrowserMultiFormatReader();
    const constraints={video:{facingMode:{ideal:"environment"}}};
    scanControls=await zxingReader.decodeFromConstraints(constraints,video,(result)=>{
      if(!result||scanLocked)return;scanLocked=true;const text=result.getText();if(scanControls){scanControls.stop();scanControls=null;}
      if(scanMode==="inventory"){
        closeCameraScanner();
        const existing=state.products.find(p=>p.barcode===text.trim());
        if(existing){ openProductModal(existing.id); showToast(`Opened ${existing.name} for editing.`); }
        else { openProductModal(null,text.trim()); }
      }
      else {scanBarcode(text);setTimeout(closeCameraScanner,350);}
    });
    status.className="scanStatus";status.textContent="Point the camera at a barcode…";
  }catch(e){console.error(e);status.className="scanStatus err";status.textContent=e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access and try again.":"Could not access the camera: "+(e.message||e.name);retry.classList.add("show");}
}
function stopCameraScan(){
  try{if(scanControls){scanControls.stop();scanControls=null;}else if(zxingReader)zxingReader.reset();}catch{}
  const v=$("#scanVideo");if(v?.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;}
}

function toggleTheme(){state.dark=!state.dark;saveState();applyTheme();}
function openSidebar(){$("#sidebar").classList.add("open");state.sidebarOpen=true}
function closeSidebar(){$("#sidebar").classList.remove("open");state.sidebarOpen=false}

async function init(){
  loadState();ensureUsers();updateDate();
  $("#mobileMenuBtn").onclick=openSidebar;$("#mobileCloseBtn").onclick=closeSidebar;$("#themeToggleBtn").onclick=toggleTheme;$("#logoutBtn").onclick=logout;
  $("#scanCancelBtn").onclick=closeCameraScanner;$("#scanRetryBtn").onclick=()=>{scanLocked=false;$("#scanRetryBtn").classList.remove("show");startCameraScan();};
  $("#uiModal").addEventListener("click",e=>{if(e.target.id==="uiModal")closeModal();});
  window.addEventListener("hashchange",()=>{if(state.user)setPage(pageFromHash(),false);});
  applyTheme();
  await initializeFirebaseData();
  if(state.user)showApp();else showLogin();
}
document.addEventListener("DOMContentLoaded",init);
