/**
 * Service worker do "modo turbo".
 *
 * O ffmpeg multi-thread so funciona em paginas isoladas (cabecalhos
 * Cross-Origin-Opener-Policy e Cross-Origin-Embedder-Policy). Como o GitHub
 * Pages e a maioria das hospedagens estaticas nao deixam configurar
 * cabecalhos, este worker os adiciona nas respostas.
 *
 * O app funciona normalmente sem ele — so um pouco mais devagar.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.cache === "only-if-cached" && requisicao.mode !== "same-origin") return;

  evento.respondWith(
    fetch(requisicao)
      .then((resposta) => {
        if (resposta.status === 0) return resposta;
        const cabecalhos = new Headers(resposta.headers);
        cabecalhos.set("Cross-Origin-Embedder-Policy", "require-corp");
        cabecalhos.set("Cross-Origin-Opener-Policy", "same-origin");
        cabecalhos.set("Cross-Origin-Resource-Policy", "cross-origin");
        return new Response(resposta.body, {
          status: resposta.status,
          statusText: resposta.statusText,
          headers: cabecalhos,
        });
      })
      .catch((erro) => {
        console.error("[modo turbo]", erro);
        return fetch(requisicao);
      }),
  );
});
