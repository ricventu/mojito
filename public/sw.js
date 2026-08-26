// A no-op service worker, deliberately, and deliberately still here.
//
// It registers nothing and caches nothing: there is no `fetch` handler at all. That
// is not an omission to be filled in later — Mojito is a thin client for a server on
// the same machine, so there is no useful offline state to serve, and a cached app
// shell would actively fight "Pull & deploy" (src/server/selfUpdate.ts), which
// rebuilds the app under a browser that would then keep serving the previous one.
//
// Nor is it load-bearing for installability. Chromium's install criteria are the
// manifest plus a secure origin; the service-worker clause was dropped, which is why
// RIC-250 could make the app installable without giving this file a fetch handler.
//
// So why keep it? Because it is already registered in browsers that have opened
// Mojito, and an installed worker outlives the file that installed it. Deleting this
// leaves those clients with a worker that 404s on every update check, which is a
// worse state than an inert one that claims its clients and gets out of the way.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
