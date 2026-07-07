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

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(ROOT, path.normalize(urlPath));
  if (!file.startsWith(ROOT)) { // no path traversal
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store", // always fresh during playtesting
    });
    res.end(data);
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
