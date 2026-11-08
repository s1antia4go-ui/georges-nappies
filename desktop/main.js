// George's Nappies desktop app (Electron). Made by Santiago Rojas.
//
// A normal online app: it opens George's Nappies straight from the internet server
// (set as "serverUrl" in package.json at build time). Nothing runs locally and
// nothing needs setting up on the user's PC.
const { app, BrowserWindow, Menu, nativeTheme, net, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const SERVER = (require("./package.json").serverUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");
const APP_URL = `${SERVER}/app/`;
let win = null;
let retryTimer = null;

function offlinePage() {
  const dark = nativeTheme.shouldUseDarkColors;
  const html = `<!doctype html><meta charset="utf-8"><title>George's Nappies</title>
  <style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:${dark ? "#080809" : "#f6f6f6"};color:${dark ? "#f0f0f1" : "#111113"}}
  main{text-align:center;padding:24px}h1{font-size:19px;margin:0 0 6px}p{opacity:.6;font-size:14px;margin:0}</style>
  <main><h1>You're offline</h1><p>George's Nappies will reconnect automatically.</p></main>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

// George's Nappies' own loading screen, shown only while the server is waking up
// (free hosting sleeps when idle). Brand font is embedded so it looks right offline too.
function loadingPage() {
  const dark = nativeTheme.shouldUseDarkColors;
  const bg = dark ? "#080809" : "#f6f6f6";
  const ink = dark ? "#f4f4f5" : "#111113";
  let fontFace = "";
  try {
    const font = fs.readFileSync(path.join(__dirname, "build", "brand.woff2")).toString("base64");
    fontFace = `@font-face{font-family:Brand;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:200 800;font-stretch:75% 100%}`;
  } catch {
    /* fall back to system font */
  }
  const html = `<!doctype html><meta charset="utf-8"><title>George's Nappies</title>
  <style>${fontFace}
  html,body{margin:0;height:100%;background:${bg};color:${ink};font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;overflow:hidden}
  main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;animation:in .6s cubic-bezier(.2,.8,.2,1) both}
  .mark{width:84px;height:84px;border-radius:26px;background:${ink};display:grid;place-items:center;animation:breathe 2.4s ease-in-out infinite}
  .mark svg{width:52px;height:52px}
  h1{margin:0;font-family:Brand,"Segoe UI",sans-serif;font-weight:780;font-stretch:86%;letter-spacing:-.04em;font-size:34px}
  .dots{display:flex;gap:7px}.dots span{width:7px;height:7px;border-radius:50%;background:${ink};opacity:.25;animation:dot 1.2s infinite ease-in-out}
  .dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}
  footer{position:fixed;bottom:26px;left:0;right:0;text-align:center;font-size:12px;opacity:.45;letter-spacing:.02em}
  @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes breathe{50%{transform:scale(.94)}}
  @keyframes dot{0%,60%,100%{opacity:.25;transform:none}30%{opacity:1;transform:translateY(-4px)}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
  <main>
    <div class="mark"><svg viewBox="0 0 24 24" fill="${bg}"><path d="M4.5 9.2C4.5 6.3 6.8 4 9.7 4h4.6c2.9 0 5.2 2.3 5.2 5.2v3.9c0 2.9-2.3 5.2-5.2 5.2h-2.6L7.8 21v-3.2a5.2 5.2 0 0 1-3.3-4.8V9.2Z"/><circle cx="9.6" cy="11" r="1.25" fill="${ink}"/><circle cx="14.4" cy="11" r="1.25" fill="${ink}"/></svg></div>
    <h1>George's Nappies</h1>
    <div class="dots"><span></span><span></span><span></span></div>
  </main>
  <footer>Made by Santiago Rojas</footer>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

// True when the George's Nappies server is up and answering (not the host's wake-up page).
async function serverAwake(timeoutMs) {
  try {
    const r = await net.fetch(`${SERVER}/api/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok) return false;
    const body = await r.json();
    return body && body.ok === true;
  } catch {
    return false;
  }
}

// Open the app straight away if the server is awake; otherwise show our loading
// screen and switch to the app the moment the server answers.
async function openApp() {
  clearTimeout(retryTimer);
  if (!net.isOnline()) {
    win.loadURL(offlinePage());
    if (!win.isVisible()) win.show();
    return scheduleRetry();
  }
  if (await serverAwake(1500)) return win.loadURL(APP_URL);
  win.loadURL(loadingPage());
  if (!win.isVisible()) win.show();
  const deadline = Date.now() + 3 * 60 * 1000;
  while (win && Date.now() < deadline) {
    if (await serverAwake(10000)) return win.loadURL(APP_URL);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (win) win.loadURL(APP_URL); // fall back to a normal load after 3 minutes
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (!win) return;
    if (net.isOnline()) openApp();
    else scheduleRetry();
  }, 3000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    show: false, // appear once the app has painted: no loading screen
    title: "George's Nappies",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#080809" : "#f6f6f6",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });

  win.once("ready-to-show", () => win.show());
  // Never leave the user staring at nothing on a slow connection.
  setTimeout(() => win && !win.isVisible() && win.show(), 2500);

  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 = aborted (e.g. a navigation replaced it); ignore.
    if (!isMainFrame || code === -3 || url.startsWith("data:")) return;
    win.loadURL(offlinePage());
    if (!win.isVisible()) win.show();
    scheduleRetry();
  });

  // Keep the window on George's Nappies; open other links in the normal browser.
  win.webContents.on("will-navigate", (e, target) => {
    if (target.startsWith(SERVER) || target.startsWith("data:")) return;
    e.preventDefault();
    if (/^https?:/.test(target)) shell.openExternal(target);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  openApp();
}

const template = [
  {
    label: "File",
    submenu: [
      { label: "Reload", accelerator: "F5", click: () => win && openApp() },
      { label: "Open website", click: () => shell.openExternal(SERVER) },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
  { label: "Help", submenu: [{ label: "George's Nappies · Made by Santiago Rojas", enabled: false }] },
];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("com.georgesnappies.desktop");
    // Only the permissions a messenger needs.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "clipboard-sanitized-write"].includes(permission)));
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
