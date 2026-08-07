/**
 * Service worker do PRICALL.
 *
 * Estratégia deliberadamente conservadora: cache apenas do casco estático.
 * Conversas e mensagens NUNCA são servidas de cache — dado de atendimento
 * desatualizado é pior que a ausência de dado.
 */
const CACHE = "pricall-casco-v1";
const ESSENCIAIS = ["/", "/offline", "/manifest.webmanifest", "/icone.svg"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;
  // API e canal de tempo real sempre vão à rede.
  if (url.pathname.startsWith("/api/")) return;

  if (requisicao.mode === "navigate") {
    evento.respondWith(
      fetch(requisicao).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match("/offline")) ?? (await cache.match("/")) ?? Response.error();
      }),
    );
    return;
  }

  evento.respondWith(
    caches.match(requisicao).then((emCache) => {
      if (emCache) return emCache;
      return fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok && resposta.type === "basic") {
            const copia = resposta.clone();
            void caches.open(CACHE).then((cache) => cache.put(requisicao, copia));
          }
          return resposta;
        })
        .catch(() => caches.match("/") ?? Response.error());
    }),
  );
});
