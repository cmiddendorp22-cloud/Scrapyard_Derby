# Authoritative Scrapyard Arena MULTIPLAYER SERVER.
#
# Build context is the REPO ROOT on purpose: server/sim-host.js loads the same
# game sim the browser runs (index.html + js/**) headlessly at runtime, so the
# whole client is copied into the image — it's READ by the sim, never served.
# The static client itself is hosted separately (Netlify); this image is ONLY
# the realtime game server.
#
# Any container host (Railway / Render / Fly / a VPS) can build + run this.
# The server listens on $PORT (host-injected) or 8090.

FROM node:20-alpine
WORKDIR /app

# install the server's ONE dependency (ws) first, for Docker layer caching.
# the client root stays dependency-free — deps live only under server/.
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# the rest of the repo: the sim scripts + index.html the server loads headlessly
COPY . .

ENV NODE_ENV=production
EXPOSE 8090

# health check for the provider's load balancer / orchestrator (busybox wget).
# honors $PORT the same way the server does.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8090}/" >/dev/null 2>&1 || exit 1

# drop root — the node image ships an unprivileged `node` user
USER node
CMD ["node", "server/server.js"]
