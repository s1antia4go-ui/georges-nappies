// George's Nappies desktop app (Electron). Made by Santiago Rojas.
//
// A normal online app: it opens George's Nappies straight from the internet server
// (set as "serverUrl" in package.json at build time). Nothing runs locally and
// nothing needs setting up on the user's PC.
const { app, BrowserWindow, Menu, nativeTheme, net, session, shell } = require("electron");
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

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (!win) return;
    if (net.isOnline()) win.loadURL(APP_URL);
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
    icon: path.join(__dirname, "build", "icon.png"),
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

  win.loadURL(APP_URL);
}

const template = [
  {
    label: "File",
    submenu: [
      { label: "Reload", accelerator: "F5", click: () => win && win.loadURL(APP_URL) },
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
