"use strict";
// Tiny zero-dependency static server for playtesting on other devices.
// Run:  node serve.js   →  open the printed LAN URL on your phone.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 8080;
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

// mirror the production (Netlify _headers) security headers so LAN testing
// behaves the same. connect-src allows ws:/wss: for the online-mode socket.
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end("method not allowed"); return; }
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); } catch (_) { res.writeHead(400); res.end("bad request"); return; }
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.indexOf("\0") !== -1) { res.writeHead(400); res.end("bad request"); return; } // null-byte injection
  const file = path.join(ROOT, path.normalize(urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { // no path traversal outside ROOT
    res.writeHead(403, SECURITY_HEADERS);
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end("not found");
      return;
    }
    res.writeHead(200, Object.assign({
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store", // always fresh during playtesting
    }, SECURITY_HEADERS));
    res.end(req.method === "HEAD" ? undefined : data);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("Scrapyard Derby is being served on:");
  console.log("  http://localhost:" + PORT);
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const n of nets[name]) {
      if (n.family === "IPv4" && !n.internal) {
        console.log("  http://" + n.address + ":" + PORT + "   <- phone URL (" + name + ")");
      }
    }
  }
});
