/* eslint-disable no-undef */
/**
 * Worker que carrega o nucleo do ffmpeg (WebAssembly) e executa as conversoes.
 * Roda fora da thread principal para que a interface nao trave durante a
 * compressao. Este arquivo e um "classic worker" de proposito: assim podemos
 * usar importScripts() para carregar o nucleo vindo do CDN.
 */

const CORE_VERSION = "0.12.10";
const CACHE_NAME = "ffmpeg-core-v1";

let core = null;
let loading = null;
let currentJob = null;

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

function coreBaseUrl(base, multithread) {
  // Com um caminho proprio (?core=...), a versao multi-thread e o mesmo
  // caminho com o sufixo "-mt", igual aos pacotes @ffmpeg/core e core-mt.
  if (base) {
    const limpo = base.replace(/\/+$/, "");
    return multithread ? `${limpo}-mt` : limpo;
  }
  // O nucleo multi-thread vem do proprio site: no modo turbo a pagina fica
  // isolada (COOP/COEP) e o navegador passa a barrar arquivos de outros
  // dominios. O de thread unica pode vir do CDN, que e mais leve de manter.
  if (multithread) return new URL("../vendor/ffmpeg-core-mt", self.location.href).href;
  return `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
}

async function openCache() {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function download(url, label, onProgress) {
  const cache = await openCache();
  let response = null;
  let fromCache = false;

  if (cache) {
    try {
      response = await cache.match(url);
      fromCache = Boolean(response);
    } catch {
      response = null;
    }
  }

  if (!response) {
    response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      throw new Error(`Nao consegui baixar ${label} (HTTP ${response.status}). Verifique sua conexao.`);
    }
    if (cache) {
      try {
        await cache.put(url, response.clone());
      } catch {
        /* cota cheia: seguimos sem cache */
      }
    }
  }

  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !response.body.getReader) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength, fromCache);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total, fromCache);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(loaded, loaded, fromCache);
  return out.buffer;
}

const blobsPorBase = new Map();

async function loadCore({ coreBase, multithread }) {
  const base = coreBaseUrl(coreBase, multithread);
  const jaBaixado = blobsPorBase.get(base);
  if (jaBaixado) return instanciar(jaBaixado);
  const files = [
    { key: "js", url: `${base}/ffmpeg-core.js`, label: "o motor de compressao", type: "text/javascript" },
    { key: "wasm", url: `${base}/ffmpeg-core.wasm`, label: "o nucleo de video (32 MB)", type: "application/wasm" },
  ];
  if (multithread) {
    files.push({
      key: "worker",
      url: `${base}/ffmpeg-core.worker.js`,
      label: "o modulo multi-thread",
      type: "text/javascript",
    });
  }

  const urls = {};
  for (const file of files) {
    const buffer = await download(file.url, file.label, (loaded, total, cached) => {
      post({ type: "core-progress", file: file.key, label: file.label, loaded, total, cached });
    });
    urls[file.key] = URL.createObjectURL(new Blob([buffer], { type: file.type }));
  }

  blobsPorBase.set(base, urls);
  return instanciar(urls);
}

/** Cria (ou recria, depois de uma falha) a instancia do ffmpeg. */
async function instanciar(urls) {
  importScripts(urls.js);
  if (typeof self.createFFmpegCore !== "function") {
    throw new Error("O motor de compressao foi baixado, mas nao pode ser inicializado neste navegador.");
  }

  const locator = btoa(JSON.stringify({ wasmURL: urls.wasm, workerURL: urls.worker || "" }));
  const instance = await self.createFFmpegCore({ mainScriptUrlOrBlob: `${urls.js}#${locator}` });

  instance.setLogger((entry) => {
    const message = entry && entry.message ? String(entry.message) : "";
    if (!message) return;
    if (currentJob && currentJob.collectStdout && entry.type === "stdout") {
      currentJob.stdout.push(message);
      return;
    }
    post({ type: "log", jobId: currentJob ? currentJob.id : null, level: entry.type, message });
  });

  instance.setProgress((entry) => {
    if (!currentJob || !entry) return;
    post({
      type: "progress",
      jobId: currentJob.id,
      // o nucleo informa o tempo ja processado em microssegundos
      seconds: Number(entry.time) > 0 ? Number(entry.time) / 1e6 : 0,
      ratio: Number(entry.progress) > 0 ? Number(entry.progress) : 0,
    });
  });

  return instance;
}

function ensureCore(config) {
  if (core) return Promise.resolve(core);
  if (!loading) {
    loading = loadCore(config)
      .then((instance) => {
        core = instance;
        return instance;
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

function run(instance, args) {
  const code = instance.exec(...args);
  instance.reset();
  return code;
}

function cleanup(instance, names) {
  for (const name of names) {
    try {
      instance.FS.unlink(name);
    } catch {
      /* arquivo ja removido */
    }
  }
}

self.onmessage = async (event) => {
  const data = event.data || {};
  try {
    if (data.type === "load") {
      await ensureCore({ coreBase: data.coreBase, multithread: data.multithread });
      post({ type: "ready", jobId: data.jobId, multithread: Boolean(data.multithread) });
      return;
    }

    // "prepare": grava o arquivo na memoria do ffmpeg e le os metadados.
    // O arquivo continua la para o passo seguinte ("run").
    if (data.type === "prepare") {
      const instance = await ensureCore({ coreBase: data.coreBase, multithread: data.multithread });
      const name = data.inputName;
      instance.FS.writeFile(name, new Uint8Array(data.data));
      currentJob = { id: data.jobId, collectStdout: true, stdout: [] };
      instance.ffprobe(
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        name,
      );
      instance.reset();
      const raw = currentJob.stdout.join("");
      currentJob = null;
      post({ type: "prepared", jobId: data.jobId, raw, inputName: name });
      return;
    }

    if (data.type === "run") {
      const instance = await ensureCore({ coreBase: data.coreBase, multithread: data.multithread });
      const { inputName, outputName, args, jobId } = data;
      if (data.data) instance.FS.writeFile(inputName, new Uint8Array(data.data));
      currentJob = { id: jobId, collectStdout: false, stdout: [] };
      const code = run(instance, args);
      currentJob = null;
      if (code !== 0) {
        cleanup(instance, [inputName, outputName]);
        throw new Error(
          `O ffmpeg terminou com erro (codigo ${code}). Veja o registro tecnico para os detalhes.`,
        );
      }
      const output = instance.FS.readFile(outputName);
      cleanup(instance, [inputName, outputName]);
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
      post({ type: "done", jobId, data: buffer, size: buffer.byteLength }, [buffer]);
      return;
    }

    throw new Error(`Mensagem desconhecida: ${data.type}`);
  } catch (error) {
    currentJob = null;
    const mensagem = error && error.message ? error.message : String(error);
    // Um "trap" do WebAssembly deixa a instancia inutilizavel: descartamos o
    // nucleo para que a proxima tentativa comece com um motor limpo.
    if (error instanceof WebAssembly.RuntimeError || /memory access|out of bounds|unreachable/i.test(mensagem)) {
      core = null;
      loading = null;
      post({
        type: "error",
        jobId: data.jobId || null,
        message: `O motor de compressao ficou sem memoria (${mensagem}).`,
      });
      return;
    }
    post({ type: "error", jobId: data.jobId || null, message: mensagem });
  }
};
