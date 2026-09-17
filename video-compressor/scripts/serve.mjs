/**
 * Servidor estatico minimo para rodar o app localmente.
 *
 *   npm run dev                 → http://localhost:8080
 *   npm run dev -- --isolate    → liga COOP/COEP (modo turbo sem service worker)
 *
 * Se o pacote @ffmpeg/core estiver instalado (npm install), o servidor tambem
 * publica o nucleo em /vendor/core, permitindo usar o app sem internet:
 *   http://localhost:8080/?core=/vendor/core
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCoreDir } from "./core-node.mjs";

const raiz = resolve(fileURLToPath(new URL("../", import.meta.url)));
const porta = Number(process.env.PORT) || 8080;
const isolar = process.argv.includes("--isolate");

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let coreDir = null;
let coreMtDir = null;
try {
  coreDir = resolveCoreDir();
  coreMtDir = coreDir.replace(/@ffmpeg[\\/]core([\\/])/, "@ffmpeg/core-mt$1");
  if (!existsSync(coreMtDir)) coreMtDir = null;
} catch {
  /* o nucleo local e opcional */
}

function arquivoPara(url) {
  const caminho = normalize(decodeURIComponent(url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  if (coreDir && caminho.startsWith("/vendor/core-mt/")) {
    return coreMtDir ? join(coreMtDir, caminho.slice("/vendor/core-mt/".length)) : null;
  }
  if (coreDir && caminho.startsWith("/vendor/core/")) {
    return join(coreDir, caminho.slice("/vendor/core/".length));
  }
  const destino = join(raiz, caminho === "/" ? "index.html" : caminho);
  return destino.startsWith(raiz) ? destino : null;
}

createServer((req, res) => {
  const destino = arquivoPara(req.url || "/");
  if (!destino || !existsSync(destino) || statSync(destino).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nao encontrado");
    return;
  }
  const cabecalhos = {
    "content-type": TIPOS[extname(destino)] || "application/octet-stream",
    "cache-control": "no-cache",
  };
  if (isolar) {
    cabecalhos["cross-origin-opener-policy"] = "same-origin";
    cabecalhos["cross-origin-embedder-policy"] = "require-corp";
    cabecalhos["cross-origin-resource-policy"] = "cross-origin";
  }
  res.writeHead(200, cabecalhos);
  createReadStream(destino).pipe(res);
}).listen(porta, () => {
  console.log(`Compressor de video em http://localhost:${porta}`);
  if (coreDir) console.log(`Nucleo local disponivel em http://localhost:${porta}/?core=/vendor/core`);
  if (isolar) console.log("COOP/COEP ligados: o modo turbo pode ser ativado.");
});
