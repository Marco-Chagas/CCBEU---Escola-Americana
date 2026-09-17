/**
 * Teste de navegador de ponta a ponta: sobe o app, envia dois videos,
 * comprime, baixa o resultado e confere o arquivo gerado.
 *
 *   npm install && npm i -D playwright && npm run test:browser
 *
 * Usa o nucleo local (/vendor/core) para nao depender de internet.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCore } from "./core-node.mjs";

const PORTA = Number(process.env.PORT) || 8123;
const pasta = mkdtempSync(join(tmpdir(), "compressor-"));
let falhas = 0;

function check(nome, ok, detalhe = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas += 1;
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  try {
    // tambem aceita uma instalacao global (NODE_PATH)
    const modulo = await import(pathToFileURL(createRequire(import.meta.url).resolve("playwright")).href);
    playwright = modulo.chromium ? modulo : modulo.default;
  } catch {
    console.log("playwright nao encontrado. Instale com: npm i -D playwright");
    process.exit(0);
  }
}

// 1. videos de teste ---------------------------------------------------------
console.log("Gerando videos de teste…");
const ff = await loadCore();
const entradas = [
  { nome: "aula-de-ingles.mp4", args: ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"] },
  { nome: "camera.mov", args: ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-f", "mov"] },
];
for (const entrada of entradas) {
  const code = ff.exec(
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "3", ...entrada.args, "-shortest", "-y", entrada.nome,
  );
  if (code !== 0) throw new Error(`Falha ao gerar ${entrada.nome}`);
  entrada.caminho = join(pasta, entrada.nome);
  entrada.bytes = ff.core.FS.readFile(entrada.nome);
  writeFileSync(entrada.caminho, entrada.bytes);
  ff.core.FS.unlink(entrada.nome);
}

// 2. servidor ----------------------------------------------------------------
const servidor = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url))], {
  env: { ...process.env, PORT: String(PORTA) },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  servidor.stdout.once("data", resolve);
  servidor.on("error", reject);
  setTimeout(() => reject(new Error("servidor nao subiu")), 10000);
});

const navegador = await playwright.chromium.launch();
try {
  const contexto = await navegador.newContext({ acceptDownloads: true });
  const pagina = await contexto.newPage();
  const errosConsole = [];
  pagina.on("pageerror", (erro) => errosConsole.push(erro.message));

  console.log("\nAbrindo o app…");
  await pagina.goto(`http://localhost:${PORTA}/?core=/vendor/core`, { waitUntil: "load" });
  // Na primeira visita o app liga o modo turbo sozinho e recarrega uma vez.
  await pagina
    .waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 20000 })
    .catch(() => {});
  await pagina.waitForLoadState("load");
  check("Pagina abriu", (await pagina.title()).includes("Compressor"));
  check("Modo turbo ligou sozinho", await pagina.evaluate(() => self.crossOriginIsolated === true));

  // 3. upload ----------------------------------------------------------------
  await pagina.setInputFiles("#arquivos", entradas.map((e) => e.caminho));
  await pagina.waitForSelector(".item");
  check("Dois videos entraram na fila", (await pagina.locator(".item").count()) === 2);

  // 4. escolher o tipo de compressao ----------------------------------------
  await pagina.selectOption("#codec", "h264");
  await pagina.selectOption("#resolucao", "480");
  await pagina.selectOption("#velocidade", "rapida");
  await pagina.locator('.nivel[data-nivel="forte"]').click();
  await pagina.selectOption("#resolucao", "480");
  check("Resumo das opcoes aparece", (await pagina.locator("#resumo").textContent()).includes("480p"));

  // 5. comprimir -------------------------------------------------------------
  console.log("Comprimindo (pode levar alguns minutos)…");
  await pagina.click("#comprimir");
  await pagina.waitForFunction(
    () => document.querySelectorAll('.item__estado[data-estado="pronto"]').length === 2,
    null,
    { timeout: 15 * 60 * 1000 },
  );
  check("Os dois videos foram comprimidos", true, await pagina.locator("#total").textContent());

  // 6. baixar ----------------------------------------------------------------
  const [download] = await Promise.all([
    pagina.waitForEvent("download"),
    pagina.locator(".item").first().getByText("Baixar").click(),
  ]);
  const baixado = join(pasta, download.suggestedFilename());
  await download.saveAs(baixado);
  check("Download individual com nome amigavel", download.suggestedFilename().endsWith("-comprimido.mp4"),
    download.suggestedFilename());

  const original = entradas[0].bytes.length;
  const comprimido = readFileSync(baixado);
  check(
    "Arquivo baixado e menor que o original",
    comprimido.length > 0 && comprimido.length < original,
    `${(original / 1024).toFixed(0)} KB → ${(comprimido.length / 1024).toFixed(0)} KB`,
  );

  ff.core.FS.writeFile("baixado.mp4", new Uint8Array(comprimido));
  const info = ff.probe("baixado.mp4");
  const video = info.streams.find((s) => s.codec_type === "video");
  check(
    "Arquivo baixado e um MP4/H.264 valido em 480p",
    video && video.codec_name === "h264" && video.height === 480 && Number(info.format.duration) > 2.5,
    `${video.codec_name} ${video.width}x${video.height} ${Number(info.format.duration).toFixed(1)}s`,
  );

  // 7. zip -------------------------------------------------------------------
  const [zipDownload] = await Promise.all([
    pagina.waitForEvent("download"),
    pagina.click("#baixarTudo"),
  ]);
  const zipCaminho = join(pasta, zipDownload.suggestedFilename());
  await zipDownload.saveAs(zipCaminho);
  const zipBytes = readFileSync(zipCaminho);
  check(
    "Download de todos em .zip",
    zipDownload.suggestedFilename().endsWith(".zip") && zipBytes.length > 1000 &&
      zipBytes[0] === 0x50 && zipBytes[1] === 0x4b,
    `${(zipBytes.length / 1024).toFixed(0)} KB`,
  );

  check("Nenhum erro de JavaScript na pagina", errosConsole.length === 0, errosConsole.join(" | "));

  // 8. motor de hardware (WebCodecs) ----------------------------------------
  // O Chromium de testes nao traz H.264/AAC (codecs proprietarios), entao o
  // caminho de hardware e exercitado com VP8/Opus, que ele suporta. Em um
  // Chrome ou Edge normal, o mesmo codigo roda com H.264 acelerado.
  console.log("\nMotor de hardware (WebCodecs)…");
  const origemWebm = join(pasta, "gravacao.webm");
  {
    const code = ff.exec(
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "3", "-c:v", "libvpx", "-b:v", "1500k", "-cpu-used", "8",
      "-c:a", "libopus", "-b:a", "96k", "-shortest", "-y", "gravacao.webm",
    );
    if (code !== 0) throw new Error("falha ao gerar o webm de teste");
    writeFileSync(origemWebm, ff.core.FS.readFile("gravacao.webm"));
    ff.core.FS.unlink("gravacao.webm");
  }

  const paginaHw = await contexto.newPage();
  const errosHw = [];
  paginaHw.on("pageerror", (erro) => errosHw.push(erro.message));
  await paginaHw.goto(`http://localhost:${PORTA}/?core=/vendor/core`, { waitUntil: "load" });
  await paginaHw
    .waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 20000 })
    .catch(() => {});
  await paginaHw.waitForLoadState("load");

  const capacidades = await paginaHw.evaluate(async () => {
    if (typeof VideoEncoder === "undefined") return null;
    const worker = new Worker("/assets/hardware-worker.js", { type: "module" });
    const resposta = await new Promise((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.postMessage({ type: "capacidades", jobId: "c" });
    });
    worker.terminate();
    return resposta;
  });
  check(
    "Motor de hardware responde as capacidades do navegador",
    capacidades && capacidades.disponivel,
    capacidades ? `vídeo: ${JSON.stringify(capacidades.video)} áudio: ${JSON.stringify(capacidades.audio)}` : "sem WebCodecs",
  );

  await paginaHw.setInputFiles("#arquivos", origemWebm);
  await paginaHw.waitForSelector(".item");
  await paginaHw.selectOption("#codec", "vp8");
  await paginaHw.selectOption("#resolucao", "360");
  await paginaHw.selectOption("#motorCompressao", "auto");
  const inicioHw = Date.now();
  await paginaHw.click("#comprimir");
  await paginaHw.waitForFunction(
    () => {
      const no = document.querySelector('.item__estado');
      return no && (no.dataset.estado === "pronto" || no.dataset.estado === "erro");
    },
    null,
    { timeout: 5 * 60 * 1000 },
  );
  const estadoHw = await paginaHw.locator(".item__estado").textContent();
  check(
    "Comprimiu usando a aceleracao por hardware",
    estadoHw.includes("(hardware)"),
    `${estadoHw.trim()} em ${((Date.now() - inicioHw) / 1000).toFixed(1)}s`,
  );

  const [downloadHw] = await Promise.all([
    paginaHw.waitForEvent("download"),
    paginaHw.locator(".item").first().getByText("Baixar", { exact: true }).click(),
  ]);
  const arquivoHw = join(pasta, downloadHw.suggestedFilename());
  await downloadHw.saveAs(arquivoHw);
  const bytesHw = readFileSync(arquivoHw);
  ff.core.FS.writeFile("hw.webm", new Uint8Array(bytesHw));
  const infoHw = ff.probe("hw.webm");
  const videoHw = infoHw.streams.find((s) => s.codec_type === "video");
  const audioHw = infoHw.streams.find((s) => s.codec_type === "audio");
  check(
    "Arquivo do hardware e um WebM valido, com audio e menor que o original",
    videoHw && videoHw.codec_name === "vp8" && audioHw && bytesHw.length < readFileSync(origemWebm).length,
    `${videoHw ? videoHw.codec_name : "?"} ${videoHw ? videoHw.width + "x" + videoHw.height : ""} + ${
      audioHw ? audioHw.codec_name : "sem audio"
    }, ${(readFileSync(origemWebm).length / 1024).toFixed(0)} KB → ${(bytesHw.length / 1024).toFixed(0)} KB`,
  );
  ff.core.FS.unlink("hw.webm");
  check("Nenhum erro de JavaScript no motor de hardware", errosHw.length === 0, errosHw.join(" | "));
} finally {
  await navegador.close();
  servidor.kill();
}

console.log(falhas ? `\n${falhas} verificacao(oes) falharam.` : "\nTudo certo no navegador.");
process.exit(falhas ? 1 : 0);
