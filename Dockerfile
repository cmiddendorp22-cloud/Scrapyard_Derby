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
CMD ["node", "server/server.js"]
