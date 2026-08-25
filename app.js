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
const STORAGE = "superpos-v2";
let firebaseDataReady = false;
let stopFirebaseRealtime = null;

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
  salesSearch: "",
  sales: [],
  user: null,   // { uid, email, name, role } — populated from Firebase Auth + staff profile
  role: null,
  modal: null,
  scanMode: "usb"   // "usb" (keyboard-wedge scanner) or "camera" — set in Settings
};
function setScanMode(mode){
  state.scanMode = mode === "camera" ? "camera" : "usb";
  saveState();
  renderPage();
  showToast(state.scanMode==="camera" ? "Camera is now the default scanner." : "USB/keyboard scanner is now the default.");
}

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const icon = (name, size = 18) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
function refreshIcons(){ if(window.lucide) window.lucide.createIcons(); }

function saveState(){
  // Only UI/session preferences are ever kept locally. Accounts, products
  // and sales all live in Firebase — never in localStorage.
  localStorage.setItem(STORAGE, JSON.stringify({ dark: state.dark, scanMode: state.scanMode }));
}
function loadState(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    state.dark = raw.dark !== false;
    state.scanMode = raw.scanMode === "camera" ? "camera" : "usb";
  }catch(e){
    state.dark = true;
    state.scanMode = "usb";
  }
  state.products = [];
  state.sales = [];
}

function firebaseStatus(){
  return window.superposFirebase?.enabled ? "Connected to Firebase" : "Firebase unavailable";
}

async function ensureFirebaseData(){
  const fb=window.superposFirebase;
  if(!fb?.enabled) throw new Error("Firebase is not available. Products and sales require Firebase.");

  // Seed the Firestore database only when it is genuinely empty, and only
  // an admin account is allowed to write products (see firestore.rules).
  const remote=await fb.loadData();
  if(!remote) throw new Error("Could not read Firestore.");

  if(!remote.products.length && isAdmin()){
    for(const p of initialProducts) await fb.addProduct(p);
  }

  stopFirebaseRealtime = fb.startRealtime(
    products => { state.products = products.sort((a,b)=>Number(a.id)-Number(b.id)); firebaseDataReady=true; renderPage(); },
    sales => { state.sales = sales; firebaseDataReady=true; renderPage(); },
    err => { console.error("Firebase realtime error:",err); showToast("Firebase realtime connection error."); }
  );

  state.products = remote.products;
  state.sales = remote.sales;
  firebaseDataReady = true;
}

function applyTheme(){
  $("#appRoot").className = state.dark ? "app dark" : "app";
  document.body.classList.toggle("lightMode", !state.dark);
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
function currentUserName(){ return state.user?.name || state.user?.email || "Staff"; }
function timeGreeting(){
  const hour=new Date().getHours();
  if(hour < 12) return "Good morning";
  if(hour < 18) return "Good afternoon";
  return "Good evening";
}
function currentRole(){ return state.role || state.user?.role || "cashier"; }
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
function activeSales(){ return state.sales.filter(s=>!s.voided); }
function filteredSales(){
  const q=state.salesSearch.trim().toLowerCase();
  if(!q) return state.sales;
  return state.sales.filter(s=>String(s.invoice||"").toLowerCase().includes(q));
}

function headHtml(eyebrow,title,sub,actions=""){
  return `<div class="pageHead"><div><small>${esc(eyebrow)}</small><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${actions}</div>`;
}
function statHtml(title,value,change,iconName){
  return `<div class="stat"><div class="statIcon">${icon(iconName,19)}</div><p>${esc(title)}</p><h2>${esc(value)}</h2><span>${icon("arrow-up-right",13)}${esc(change)}</span></div>`;
}

// --- Reporting helpers: real data instead of decorative fixed numbers ----
function salesTrendData(days=7){
  const now=new Date();
  const buckets=[];
  for(let i=days-1;i>=0;i--){
    const d=new Date(now); d.setDate(d.getDate()-i);
    buckets.push({ label:d.toLocaleDateString("en-US",{weekday:"short"}), key:d.toDateString(), total:0 });
  }
  activeSales().forEach(s=>{
    const key=new Date(s.date).toDateString();
    const b=buckets.find(x=>x.key===key);
    if(b) b.total += Number(s.total||0);
  });
  return buckets;
}
function salesByCategoryData(){
  const map={};
  activeSales().forEach(s=>s.items.forEach(i=>{
    const p=state.products.find(x=>x.id===i.id);
    const cat=p?.category || "Other";
    map[cat]=(map[cat]||0)+Number(i.price||0)*Number(i.qty||0);
  }));
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

function dashboardRecentSalesHtml(sales){
  sales = [...sales].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  if(!sales.length){
    return `<div class="recentSalesEmpty">${icon("receipt",28)}<div><b>No completed sales yet</b><span>Completed bills will appear here automatically.</span></div></div>`;
  }
  return `<div class="recentSalesList">${sales.slice(0,8).map(s=>`
    <button class="recentSaleRow" data-view-invoice="${esc(s.invoice)}" title="View ${esc(s.invoice)}">
      <span class="recentSaleIcon">${icon("receipt-text",16)}</span>
      <span class="recentSaleMain"><b>${esc(s.invoice)}</b><small>${esc(formatDateTime(s.date))} · ${esc(s.cashier||"Staff")}</small></span>
      <strong>${money(s.total)}</strong>
      <span class="status">Completed</span>
      ${icon("chevron-right",15)}
    </button>`).join("")}</div>`;
}

function renderDashboard(){
  const sales=activeSales();
  const low=state.products.filter(p=>p.stock>0 && p.stock<=7);
  const out=state.products.filter(p=>Number(p.stock)<=0);
  const today=sales.filter(s=>new Date(s.date).toDateString()===new Date().toDateString());
  const todayTotal=today.reduce((a,s)=>a+Number(s.total||0),0);
  const monthSales=sales.filter(s=>{const d=new Date(s.date),n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();}).reduce((a,s)=>a+Number(s.total||0),0);
  const trend=salesTrendData(7);
  const maxTrend=Math.max(1,...trend.map(t=>t.total));
  return `${headHtml("DASHBOARD",`${timeGreeting()}, ${currentUserName()} 👋`,"Here's what's happening with your store today.",
    `<button class="primary" id="dashOpenPos">${icon("shopping-cart",16)} Open POS</button>`)}
    <div class="stats">
      ${statHtml("Today Total Sales",money(todayTotal),`${today.length} completed today`,"receipt-text")}
      ${statHtml("Orders",String(today.length),"+ today","shopping-cart")}
      ${statHtml("Products",String(state.products.length),"in inventory","package")}
      ${statHtml("Monthly Sales",money(monthSales),"current month","trending-up")}
    </div>
    <div class="two">
      <div class="panel dashboardChartPanel"><div class="panelHead"><div><h2>Sales Overview</h2><p>Last 7 days revenue</p></div><button class="link" id="dashViewSales">View all</button></div>
      <div class="chart">${trend.map(t=>`<div class="barWrap"><div class="bar" style="height:${Math.max(4,(t.total/maxTrend)*100)}%" title="${esc(money(t.total))}"></div><span>${esc(t.label)}</span></div>`).join("")}</div></div>
      <div class="panel"><div class="panelHead"><div><h2>Stock Alerts</h2><p>Products needing attention</p></div><button class="link" id="dashViewInventory">View all</button></div>
      ${low.length?low.slice(0,4).map(p=>`<div class="stock stockLowRow"><div class="mini">${esc(p.name[0])}</div><div><b>${esc(p.name)}</b><span>${esc(p.category)}</span></div><strong class="warn">${p.stock} left</strong></div>`).join(""):``}
      ${out.length?out.slice(0,3).map(p=>`<div class="stock stockOutRow"><div class="mini">${esc(p.name[0])}</div><div><b>${esc(p.name)}</b><span>${esc(p.category)}</span></div><strong class="danger">Out</strong></div>`).join(""):``}
      ${!low.length&&!out.length?`<div class="empty" style="height:180px">All products have healthy stock.</div>`:""}</div>
    </div>
    <div class="panel recentSalesPanel"><div class="panelHead"><div><h2>Recent Sales</h2><p>Latest completed bills from Firebase</p></div><button class="link" id="dashViewSales2">View all</button></div>${dashboardRecentSalesHtml(sales)}</div>`;
}

function posProductsGridHtml(){
  const products=filteredPOS();
  if(!products.length)return `<div class="searchResultsEmpty">No products match your search.</div>`;
  return products.map(p=>{
    const out=Number(p.stock)<=0;
    const low=!out && Number(p.stock)<=7;
    return `<button class="product ${out?"outOfStock":"inStock"}" data-id="${p.id}" ${out?"disabled":""}>
      <div class="productImg productLetter" aria-hidden="true">${esc((p.name||"P").slice(0,1).toUpperCase())}</div>
      <div class="productInfo">
        <b>${esc(p.name)}</b><span>${esc(p.category)}</span><strong>${money(p.price)}</strong>
        <small class="stockLabel ${out?"stockOut":low?"stockLow":""}">${out?"Out of stock":`${p.stock} in stock`}</small>
      </div>
      ${out?`<em class="stockBadge stockBadgeOut">OUT</em>`:low?`<em class="stockBadge stockBadgeLow">LOW</em>`:`<em class="stockBadge stockBadgeOk">IN STOCK</em>`}
      <span class="productAction">${out?icon("ban",16):icon("plus",16)}</span>
    </button>`;
  }).join("");
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
  return `<div class="pos"><div class="panel">
      <div class="search posUnifiedSearch"><div class="searchIcon">${icon("search",16)}</div><input id="posSearchInput" ${state.scanMode==="usb"?"autofocus":""} placeholder="Search product or scan barcode…" value="${esc(state.search)}"/><button class="cameraIconBtn" id="cameraScanBtn" title="Scan barcode with camera" aria-label="Scan barcode">${icon("barcode",18)}</button></div>
      <div class="products" id="posProductsGrid">${posProductsGridHtml()}</div>
    </div>
    <div class="panel cart" id="cartPanel">${cartPanelInnerHtml()}</div></div>
    <button class="posScanFab" id="posScanFab" aria-label="Scan barcode" title="Scan barcode">${icon("barcode",18)}<span>Scan</span></button>
    <button class="cartFab" id="cartFab" aria-label="Open cart">${icon("shopping-cart",18)}<span>Cart</span><span class="cartCount">${count}</span></button>`;
}
function renderInventory(){
  const products=filteredInventory();
  const statusHtml=p=>Number(p.stock)<=0?`<span class="inventoryStatus out">Out of Stock</span>`:Number(p.stock)<=7?`<span class="inventoryStatus low">Low Stock</span>`:`<span class="inventoryStatus in">In Stock</span>`;
  return `${headHtml("INVENTORY","Products","Manage stock, prices and products.",
    `<div class="inventoryToolbar"><div class="search inventorySearch"><div class="searchIcon">${icon("search",15)}</div><input id="inventorySearchInput" placeholder="Search products or scan barcode…" value="${esc(state.inventorySearch)}"/><button class="cameraIconBtn inventoryCameraBtn" id="invCameraScanBtn" title="Scan barcode with camera" aria-label="Scan barcode">${icon("barcode",18)}</button></div><div class="inventoryDesktopActions"><button class="primary" id="invDesktopAddBtn">${icon("plus",15)} Add Product</button></div></div>`)}
    <div class="panel tablePanel scrollPanel"><div class="panelHead"><div><h2>Product Inventory</h2><p>${products.length} products shown</p></div></div>
    <div class="tableWrap"><table><thead><tr><th>PRODUCT</th><th>BARCODE</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
    ${products.map(p=>`<tr><td><div class="productCell"><b>${esc(p.name)}</b></div></td><td class="mono">${esc(p.barcode)}</td><td>${esc(p.category)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${statusHtml(p)}</td><td><div class="rowActions"><button class="rowBtn edit" data-edit="${p.id}" title="Edit">${icon("pencil",14)}</button><button class="rowBtn delete" data-delete="${p.id}" title="Delete">${icon("trash-2",14)}</button></div></td></tr>`).join("")}
    </tbody></table></div>
    <div class="inventoryMobileList">${products.map(p=>`<article class="inventoryCard ${Number(p.stock)<=0?"isOut":Number(p.stock)<=7?"isLow":""}"><div class="inventoryCardTop"><div class="productLetter">${esc((p.name||"P").slice(0,1).toUpperCase())}</div><div class="inventoryCardMain"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.barcode)}</small><div><strong>${money(p.price)}</strong><span>Stock: ${p.stock}</span></div></div>${statusHtml(p)}</div><div class="inventoryCardActions"><button class="rowBtn edit" data-edit="${p.id}">${icon("pencil",14)} Edit</button><button class="rowBtn delete" data-delete="${p.id}">${icon("trash-2",14)}</button></div></article>`).join("")}</div>
    </div>
    <div class="inventoryQuickActions"><button class="quickAction scanAction" id="invScanBtn">${icon("barcode",18)}<span>Scan</span></button><button class="quickAction addAction" id="invAddBtn">${icon("plus",18)}<span>Add Product</span></button></div>`;
}

function salesTableHtml(sales){
  if(!sales.length)return `<div class="salesEmpty">${icon("receipt",35)}<p>No completed bills yet.</p></div>`;
  return `<div class="tableWrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>CASHIER</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
  ${sales.map(s=>`<tr class="${s.voided?"voidedRow":""}"><td class="invoiceId">${esc(s.invoice)}</td><td>${esc(formatDateTime(s.date))}</td><td>${esc(s.cashier)}</td><td>${s.items.reduce((a,i)=>a+i.qty,0)}</td><td>${money(s.total)}</td><td>${s.voided?`<span class="status dangerStatus" title="${esc(s.voidReason||"")}">Voided</span>`:`<span class="status">Completed</span>`}</td><td><div class="invoiceActions"><button class="rowBtn edit" data-view-invoice="${esc(s.invoice)}" title="View bill">${icon("eye",14)}</button><button class="rowBtn" data-print-invoice="${esc(s.invoice)}" title="Print bill">${icon("printer",14)}</button>${(isAdmin()&&!s.voided)?`<button class="rowBtn delete" data-void-invoice="${esc(s.invoice)}" title="Void bill (admin only)">${icon("ban",14)}</button>`:""}</div></td></tr>`).join("")}
  </tbody></table></div>
  <div class="salesMobileList">${sales.map(s=>`<article class="salesMobileCard ${s.voided?"isVoided":""}"><div class="salesMobileTop"><div><b>${esc(s.invoice)}</b><small>${esc(formatDateTime(s.date))}</small></div>${s.voided?`<span class="inventoryStatus out">Voided</span>`:`<span class="inventoryStatus in">Completed</span>`}</div><div class="salesMobileMeta"><span>Cashier: <b>${esc(s.cashier||"Staff")}</b></span><span>Items: <b>${s.items.reduce((a,i)=>a+i.qty,0)}</b></span><strong>${money(s.total)}</strong></div><div class="salesMobileActions"><button class="rowBtn edit" data-view-invoice="${esc(s.invoice)}">${icon("eye",14)} View Bill</button><button class="rowBtn" data-print-invoice="${esc(s.invoice)}">${icon("printer",14)} Print</button>${(isAdmin()&&!s.voided)?`<button class="rowBtn delete" data-void-invoice="${esc(s.invoice)}">${icon("ban",14)} Void</button>`:""}</div></article>`).join("")}</div>`;
}
function renderSales(){
  const sales=filteredSales();
  return `${headHtml("SALES","Sales History","View, print and void completed bills.",
    `<div class="salesToolbar"><div class="search salesSearch">${icon("search",15)}<input id="salesSearchInput" placeholder="Search invoice number…" value="${esc(state.salesSearch)}"/><span class="salesSearchHint">INV-</span></div><button class="secondaryBtn" id="salesRefreshBtn">${icon("refresh-cw",15)} Refresh</button></div>`)}
    <div class="panel tablePanel scrollPanel"><div class="panelHead"><div><h2>Past Bills</h2><p>${sales.length} matching transaction${sales.length===1?"":"s"}${state.salesSearch.trim()?` · invoice search: ${esc(state.salesSearch.trim())}`:""}${isAdmin()?"":" · voiding is admin-only"}</p></div></div>${salesTableHtml(sales)}</div>`;
}
function renderReports(){
  const sales=activeSales();
  const total=sales.reduce((a,s)=>a+s.total,0);
  const items=sales.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty,0),0);
  const trend=salesTrendData(7);
  const maxTrend=Math.max(1,...trend.map(t=>t.total));
  const byCategory=salesByCategoryData();
  const maxCat=Math.max(1,...byCategory.map(c=>c[1]));
  return `${headHtml("ANALYTICS","Reports","Understand your store performance.")}<div class="stats">${statHtml("Total Revenue",money(total),"all saved sales","bar-chart-3")}${statHtml("Gross Profit",money(Math.round(total*.25)),"estimated","trending-up")}${statHtml("Orders",String(sales.length),"completed","shopping-cart")}${statHtml("Items Sold",String(items),"all sales","receipt-text")}</div>
  <div class="two">
    <div class="panel"><div class="panelHead"><div><h2>Sales Trend</h2><p>Revenue over the last 7 days</p></div></div>
      <div class="bigChart">${trend.map(t=>`<div class="barWrap"><div class="bar" style="height:${Math.max(4,(t.total/maxTrend)*100)}%" title="${esc(money(t.total))}"></div><span>${esc(t.label)}</span></div>`).join("")}</div></div>
    <div class="panel"><div class="panelHead"><div><h2>Sales by Category</h2><p>Revenue by product category</p></div></div>
      ${byCategory.length?`<div class="catBarList">${byCategory.map(([cat,val])=>`<div class="catBarRow"><span>${esc(cat)}</span><div class="catBarTrack"><div class="catBar" style="width:${Math.max(4,(val/maxCat)*100)}%"></div></div><b>${money(val)}</b></div>`).join("")}</div>`:`<div class="empty" style="height:220px">No sales yet.</div>`}
    </div>
  </div>`;
}
function renderSettings(){
  return `${headHtml("SYSTEM","Settings","Store preferences and account controls.")}<div class="settings">
  <div class="panel setting">${icon("shield-check",22)}<h2>Security</h2><p>Signed in with Firebase Authentication. Changing your password here updates it for every device you sign in on.</p><button id="changePasswordBtn">Change password</button></div>
  <div class="panel setting">${icon("barcode",22)}<h2>Scanning</h2><p>Choose which input the barcode field on Point of Sale is optimized for. A USB/keyboard scanner works either way — this just decides which one gets focus automatically.</p>
    <div class="scanModeToggle" id="scanModeToggle">
      <button class="scanModeBtn${state.scanMode==="usb"?" active":""}" data-scan-mode="usb">${icon("keyboard",15)} USB Scanner</button>
      <button class="scanModeBtn${state.scanMode==="camera"?" active":""}" data-scan-mode="camera">${icon("camera",15)} Camera</button>
    </div>
  </div>
  <div class="panel setting">${icon("database",22)}<h2>Data</h2><p>${esc(firebaseStatus())}. Products and bills are synchronized in real time through Firestore, protected by role-based security rules.</p></div>
  <div class="panel setting">${icon("user-round",22)}<h2>Account</h2><p>Signed in as ${esc(currentUserName())} (${esc(roleLabel())}). Log out from the sidebar when needed.</p><button id="settingsLogoutBtn">Log out</button></div>
  </div>`;
}

function renderPage(){
  /* Instant page switching: POS/Inventory and their fixed mobile controls
     must not slide, fade, or animate when the section changes. */
  const contentForTransition=$("#content");
  if(contentForTransition){
    contentForTransition.classList.remove("pageSlideInLeft","pageSlideInRight");
    contentForTransition.dataset.pageName=state.page;
  }
  document.body.classList.toggle("posMode",state.page==="Point of Sale");
  document.body.classList.toggle("dashboardMode",state.page==="Dashboard");
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

  // Compact bottom navigation for phone portrait mode. The fourth button is
  // intentionally a menu trigger so admin-only pages remain available.
  const mobileNav=$("#mobileBottomNav");
  if(mobileNav){
    mobileNav.querySelectorAll(".mobileNavBtn[data-page]").forEach(b=>{
      const page=b.dataset.page;
      b.classList.toggle("active",state.page===page);
      b.disabled=!allowed.some(n=>n.name===page);
      b.onclick=()=>{ if(!b.disabled) setPage(page); };
    });
    const activeIndex=["Dashboard","Point of Sale","Inventory"].indexOf(state.page);
    mobileNav.style.setProperty("--nav-index",String(activeIndex>=0?activeIndex:0));
    mobileNav.classList.remove("menu-active");
    const menu=$("#mobileMenuNav");
    if(menu) menu.onclick=openMobileMenu;
  }
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
  if(state.page==="Dashboard") $$(".recentSaleRow[data-view-invoice]").forEach(b=>b.onclick=()=>showInvoice(b.dataset.viewInvoice));

  if(state.page==="Point of Sale"){
    attachProductGridListeners();attachCartListeners();
    const search=$("#posSearchInput");
    if(search){
      search.oninput=e=>{state.search=e.target.value;renderPOSGridOnly();};
      search.onkeydown=e=>{
        if(e.key!=="Enter")return;
        const value=search.value.trim();
        if(!value)return;
        const exact=state.products.find(p=>String(p.barcode||"").toLowerCase()===value.toLowerCase());
        if(exact){scanBarcode(value);state.search="";search.value="";renderPOSGridOnly();}
      };
    }
    const cam=$("#cameraScanBtn");if(cam)cam.onclick=()=>openCameraScanner("pos");
    const scanFab=$("#posScanFab");if(scanFab)scanFab.onclick=()=>openCameraScanner("pos");
    const fab=$("#cartFab");if(fab)fab.onclick=openMobileCart;
  }
  if(state.page==="Inventory"){
    const search=$("#inventorySearchInput");if(search){search.oninput=e=>{state.inventorySearch=e.target.value;renderPage();setTimeout(()=>{const el=$("#inventorySearchInput");if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},0);};search.onkeydown=e=>{if(e.key!=="Enter")return;const value=search.value.trim();if(!value)return;const exact=state.products.find(p=>String(p.barcode||"").toLowerCase()===value.toLowerCase());if(exact){openProductModal(Number(exact.id));}};}
    const add=$("#invAddBtn");if(add)add.onclick=()=>openProductModal();
    const desktopAdd=$("#invDesktopAddBtn");if(desktopAdd)desktopAdd.onclick=()=>openProductModal();
    const scan=$("#invScanBtn");if(scan)scan.onclick=()=>openCameraScanner("inventory");
    const inventoryCamera=$("#invCameraScanBtn");if(inventoryCamera)inventoryCamera.onclick=()=>openCameraScanner("inventory");
    $$("[data-edit]").forEach(b=>b.onclick=()=>openProductModal(Number(b.dataset.edit)));
    $$("[data-delete]").forEach(b=>b.onclick=()=>confirmDelete(Number(b.dataset.delete)));
  }
  if(state.page==="Sales"){
    const r=$("#salesRefreshBtn");if(r)r.onclick=()=>renderPage();
    const salesSearch=$("#salesSearchInput");
    if(salesSearch){
      salesSearch.oninput=e=>{state.salesSearch=e.target.value;renderPage();setTimeout(()=>{const el=$("#salesSearchInput");if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}},0);};
    }
    $$(`[data-view-invoice]`).forEach(b=>b.onclick=()=>showInvoice(b.dataset.viewInvoice));
    $$(`[data-print-invoice]`).forEach(b=>b.onclick=()=>printInvoice(b.dataset.printInvoice));
    $$(`[data-void-invoice]`).forEach(b=>b.onclick=()=>confirmVoidBill(b.dataset.voidInvoice));
  }
  if(state.page==="Settings"){
    const cp=$("#changePasswordBtn");if(cp)cp.onclick=openChangePassword;
    const lo=$("#settingsLogoutBtn");if(lo)lo.onclick=logout;
    $$("[data-scan-mode]").forEach(b=>b.onclick=()=>setScanMode(b.dataset.scanMode));
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
let audioCtx=null;
function beep(ok=true){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended") audioCtx.resume();
    const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
    osc.type="square";
    osc.frequency.value = ok ? 1500 : 300;
    gain.gain.setValueAtTime(0.001,audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18,audioCtx.currentTime+0.01);
    gain.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+(ok?0.11:0.22));
    osc.connect(gain);gain.connect(audioCtx.destination);
    osc.start();osc.stop(audioCtx.currentTime+(ok?0.12:0.24));
    if(!ok){
      // A quick low double-beep reads as "not found", distinct from the
      // single high beep for a successful scan.
      setTimeout(()=>{
        const osc2=audioCtx.createOscillator(), gain2=audioCtx.createGain();
        osc2.type="square";osc2.frequency.value=300;
        gain2.gain.setValueAtTime(0.001,audioCtx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.18,audioCtx.currentTime+0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.18);
        osc2.connect(gain2);gain2.connect(audioCtx.destination);
        osc2.start();osc2.stop(audioCtx.currentTime+0.19);
      },140);
    }
  }catch(e){ /* Audio not available (e.g. autoplay-blocked) — silently skip. */ }
}
function scanBarcode(code){
  const t=(code||"").trim();if(!t)return;
  const p=state.products.find(x=>x.barcode===t);
  if(p){beep(true);addToCart(p.id);}
  else{beep(false);showToast("Product not found. Add it in Inventory first.");}
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
    ${sale.voided?`<div class="voidedBanner">VOIDED${sale.voidReason?" — "+esc(sale.voidReason):""}</div>`:""}
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
  w.document.write(`<!doctype html><html><head><title>${esc(sale.invoice)}</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111}h2{margin:0}p{font-size:12px;color:#555}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;font-size:12px}.total{text-align:right;font-size:18px;font-weight:700;margin-top:18px}.voidedBanner{margin-top:10px;color:#c0293b;font-weight:800;border:1px solid #c0293b55;background:#c0293b11;padding:8px 10px;border-radius:8px;font-size:12px}@media print{button{display:none}}</style></head><body>${invoiceHtml(sale)}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
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

// Bills are voided rather than deleted so there's always an audit trail —
// enforced both here (button only shown to admins) and in firestore.rules
// (only an admin account can perform the update).
function confirmVoidBill(invoice){
  if(!isAdmin())return;
  const sale=state.sales.find(s=>s.invoice===invoice);if(!sale)return;
  openModal(`<div class="modalHead"><div><h3>Void this bill?</h3><p>Admin only. The bill stays on record, marked voided, for your audit history.</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div>
  <p class="confirmText">Void <b>${esc(invoice)}</b> for ${money(sale.total)}? This cannot be undone.</p>
  <form id="voidForm"><div class="field full"><label>Reason</label><input name="reason" required placeholder="e.g. Duplicate bill, customer changed order"></div>
  <div class="modalFooter"><button type="button" class="secondaryBtn" id="modalCancel">Cancel</button><button class="dangerBtn" type="submit">${icon("ban",15)} Void Bill</button></div></form>`);
  $("#modalCloseBtn").onclick=closeModal;$("#modalCancel").onclick=closeModal;
  $("#voidForm").onsubmit=async e=>{
    e.preventDefault();
    const reason=String(new FormData(e.target).get("reason")).trim();
    const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;
    try{
      await window.superposFirebase.voidSale(invoice,reason,currentUserName());
      closeModal();
      showToast("Bill voided.");
    }catch(err){
      console.error("Void failed:",err);
      showToast(err.message || "Could not void bill.");
    }finally{btn.disabled=false;}
  };
}

// --- Password show/hide ---------------------------------------------------
// Wires up every ".pwToggle" button next to a password <input> inside root.
function wirePasswordToggles(root=document){
  root.querySelectorAll(".pwToggle").forEach(btn=>{
    if(btn._wired)return; btn._wired=true;
    btn.onclick=()=>{
      const input=btn.previousElementSibling;
      if(!input)return;
      const show=input.type==="password";
      input.type=show?"text":"password";
      btn.innerHTML=icon(show?"eye-off":"eye",16);
      btn.setAttribute("aria-label",show?"Hide password":"Show password");
      refreshIcons();
    };
  });
}
function passwordFieldHtml(label,name,opts={}){
  const {required=true,minlength,autocomplete,placeholder=""}=opts;
  return `<div class="field passwordField"><label>${esc(label)}</label><div class="passwordWrap">
    <input name="${name}" type="password" ${required?"required":""} ${minlength?`minlength="${minlength}"`:""} ${autocomplete?`autocomplete="${autocomplete}"`:""} placeholder="${esc(placeholder)}">
    <button type="button" class="pwToggle" aria-label="Show password">${icon("eye",16)}</button>
  </div></div>`;
}

function friendlyAuthError(err){
  const code=err?.code || "";
  const map={
    "auth/invalid-email":"That doesn't look like a valid email address.",
    "auth/invalid-credential":"Incorrect email or password.",
    "auth/wrong-password":"Incorrect email or password.",
    "auth/user-not-found":"Incorrect email or password.",
    "auth/too-many-requests":"Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed":"Network error. Check your connection and try again.",
    "auth/weak-password":"Please choose a stronger password (at least 6 characters).",
    "auth/requires-recent-login":"For security, please sign in again before changing your password."
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}

function openChangePassword(){
  openModal(`<div class="modalHead"><div><h3>Change password</h3><p>This updates your password for every device you sign in on — not just this one.</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div>
  <form id="passwordForm">
    ${passwordFieldHtml("Current password","current",{autocomplete:"current-password"})}
    ${passwordFieldHtml("New password","next",{minlength:6,autocomplete:"new-password"})}
    <div class="modalFooter"><button type="button" class="secondaryBtn" id="modalCancel">Cancel</button><button class="primary" type="submit">Update Password</button></div>
  </form>`);
  wirePasswordToggles();
  $("#modalCloseBtn").onclick=closeModal;$("#modalCancel").onclick=closeModal;
  $("#passwordForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;
    try{
      await window.superposFirebase.changePassword(fd.get("current"),fd.get("next"));
      closeModal();
      showToast("Password changed — it now applies on every device.");
    }catch(err){
      console.error("Change password failed:",err);
      showToast(friendlyAuthError(err));
    }finally{btn.disabled=false;}
  };
}
function openForgotPassword(){
  openModal(`<div class="modalHead"><div><h3>Reset your password</h3><p>We'll email you a secure link to set a new password.</p></div><button class="modalClose" id="modalCloseBtn">${icon("x",16)}</button></div>
  <form id="forgotForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="you@yourstore.com"></div>
  <div class="modalFooter"><button type="button" class="secondaryBtn" id="modalCancel">Cancel</button><button class="primary" type="submit">Send reset link</button></div></form>`);
  $("#modalCloseBtn").onclick=closeModal;$("#modalCancel").onclick=closeModal;
  $("#forgotForm").onsubmit=async e=>{
    e.preventDefault();
    const email=String(new FormData(e.target).get("email")).trim();
    const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;
    try{
      await window.superposFirebase.sendPasswordReset(email);
      closeModal();
      showToast("Reset email sent — check your inbox.");
    }catch(err){
      console.error("Password reset failed:",err);
      showToast(friendlyAuthError(err));
    }finally{btn.disabled=false;}
  };
}

function openModal(html,wide=false){const m=$("#uiModal");const c=$("#uiModalCard");c.className=`uiModalCard${wide?" wide":""}`;c.innerHTML=html;m.classList.add("open");m.setAttribute("aria-hidden","false");refreshIcons();}
function closeModal(){const m=$("#uiModal");m.classList.remove("open");m.setAttribute("aria-hidden","true");$("#uiModalCard").innerHTML="";}

function showToast(message){
  let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.style.cssText="position:fixed;right:18px;bottom:18px;z-index:3000;padding:12px 15px;border:1px solid var(--border);background:#12182fee;color:#fff;border-radius:11px;font-size:11px;box-shadow:0 15px 40px #0008;opacity:0;transform:translateY(8px);transition:.2s";document.body.appendChild(t);}
  t.textContent=message;t.style.opacity="1";t.style.transform="translateY(0)";clearTimeout(t._timer);t._timer=setTimeout(()=>{t.style.opacity="0";t.style.transform="translateY(8px)"},2600);
}

function renderLogin(message=""){
  $("#loginScreen").innerHTML=`<div class="loginCard"><div class="loginBrand"><div class="brandIcon">${icon("shopping-cart",21)}</div><div><b>SuperPOS</b><span>Inventory System</span></div></div><h1>Welcome back</h1><p>Sign in with your SuperPOS account to continue.</p>
  <form id="loginForm">
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required placeholder="you@yourstore.com"></div>
    ${passwordFieldHtml("Password","password",{autocomplete:"current-password",placeholder:"••••••••"})}
    <div class="loginError" id="loginError">${esc(message)}</div>
    <button class="primary" type="submit" style="width:100%">Sign in</button>
  </form>
  <button type="button" class="link" id="forgotPasswordLink" style="margin-top:12px">Forgot your password?</button>
  <div class="loginHint">Ask an administrator if you don't have an account yet.</div></div>`;
  wirePasswordToggles();
  $("#loginForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const email=String(fd.get("email")).trim();
    const password=String(fd.get("password"));
    const btn=e.target.querySelector('button[type="submit"]');
    btn.disabled=true;$("#loginError").textContent="";
    try{
      await window.superposFirebase.signIn(email,password);
      // onAuthChange picks up the signed-in user and shows the app.
    }catch(err){
      console.error("Sign-in failed:",err);
      $("#loginError").textContent=friendlyAuthError(err);
      btn.disabled=false;
    }
  };
  $("#forgotPasswordLink").onclick=openForgotPassword;
  refreshIcons();
}
function showLogin(message=""){stopCameraScan();$("#appShell").style.display="none";$("#loginScreen").classList.add("show");renderLogin(message);}
function showApp(){
  $("#loginScreen").classList.remove("show");$("#appShell").style.display="block";
  $("#sidebarUserName").textContent=currentUserName();$("#sidebarAvatar").textContent=currentUserName()[0]?.toUpperCase()||"A";$("#topAvatar").textContent=currentUserName()[0]?.toUpperCase()||"A";
  const roleNode=$("#sidebarUserName")?.parentElement?.querySelector("span"); if(roleNode) roleNode.innerHTML=`${icon(isAdmin()?"shield-check":"badge-check",11)} ${roleLabel()}`;
  const mobileTitle=$("#mobileTitle"); if(mobileTitle) mobileTitle.textContent=isAdmin()?"SuperPOS":"Cashier POS";
  applyTheme();setPage(pageFromHash(),false);
}
async function logout(){
  try{ await window.superposFirebase.signOutUser(); }
  catch(err){ console.error("Sign-out failed:",err); }
  state.cart=[];
  // state.user is cleared by the onAuthChange handler once Firebase confirms sign-out.
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
        beep(true);
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
function openMobileMenu(){
  const existing=$("#mobileQuickMenu"); if(existing) existing.remove();
  const mobileNav=$("#mobileBottomNav");
  if(mobileNav){
    mobileNav.style.setProperty("--nav-index","3");
    mobileNav.classList.add("menu-active");
  }
  const div=document.createElement("div"); div.id="mobileQuickMenu"; div.className="uiModal open";
  const items=allowedNav().filter(n=>["Sales","Reports","Settings"].includes(n.name));
  div.innerHTML=`<div class="uiModalCard mobileQuickMenuCard"><div class="modalHead"><div><h3>Menu</h3><p>More SuperPOS sections</p></div><button class="modalClose" id="closeMobileQuickMenu">${icon("x",16)}</button></div><div class="mobileQuickMenuList">${items.map(n=>`<button class="mobileQuickMenuItem" data-mobile-page="${esc(n.name)}">${icon(n.icon,18)}<span>${esc(n.name)}</span>${icon("chevron-right",15)}</button>`).join("")}</div></div>`;
  document.body.appendChild(div); refreshIcons();
  const close=()=>{div.remove(); if(mobileNav){mobileNav.classList.remove("menu-active"); const idx=["Dashboard","Point of Sale","Inventory"].indexOf(state.page); mobileNav.style.setProperty("--nav-index",String(idx>=0?idx:0));}};
  $("#closeMobileQuickMenu").onclick=close;
  div.querySelectorAll("[data-mobile-page]").forEach(b=>b.onclick=()=>{const page=b.dataset.mobilePage;close();setPage(page);});
}

function openSidebar(){$("#sidebar").classList.add("open");state.sidebarOpen=true}
function closeSidebar(){$("#sidebar").classList.remove("open");state.sidebarOpen=false}

async function init(){
  loadState();updateDate();
  $("#mobileMenuBtn").onclick=openSidebar;$("#mobileCloseBtn").onclick=closeSidebar;$("#themeToggleBtn").onclick=toggleTheme;$("#logoutBtn").onclick=logout;
  $("#scanCancelBtn").onclick=closeCameraScanner;$("#scanRetryBtn").onclick=()=>{scanLocked=false;$("#scanRetryBtn").classList.remove("show");startCameraScan();};
  $("#uiModal").addEventListener("click",e=>{if(e.target.id==="uiModal")closeModal();});
  window.addEventListener("hashchange",()=>{if(state.user)setPage(pageFromHash(),false);});
  applyTheme();

  const fb=window.superposFirebase;
  if(!fb?.enabled){
    showLogin("Firebase isn't configured. Check firebase-config.js.");
    return;
  }

  fb.onAuthChange(async fbUser=>{
    if(fbUser){
      try{
        const profile=await fb.getStaffProfile(fbUser.uid);
        if(!profile){
          // A real account, but no staff/role record — reject sign-in rather
          // than silently defaulting anyone to admin.
          await fb.signOutUser();
          showLogin("Your account isn't set up for SuperPOS yet. Ask an administrator to add you.");
          return;
        }
        state.user={uid:fbUser.uid,email:fbUser.email,name:profile.name||fbUser.email,role:profile.role||"cashier"};
        state.role=state.user.role;
        await ensureFirebaseData();
        showApp();
      }catch(err){
        console.error("Sign-in setup failed:",err);
        showLogin(err.message||"Could not load your account. Please try again.");
      }
    }else{
      if(stopFirebaseRealtime){stopFirebaseRealtime();stopFirebaseRealtime=null;}
      state.user=null;state.role=null;state.products=[];state.sales=[];firebaseDataReady=false;
      showLogin();
    }
  });
}
document.addEventListener("DOMContentLoaded",init);
