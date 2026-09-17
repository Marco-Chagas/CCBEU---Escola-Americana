/**
 * Interface do compressor de video.
 *
 * Responsabilidades: montar os controles, conversar com o worker do ffmpeg,
 * mostrar o progresso e entregar os downloads. As regras de compressao em si
 * ficam em compression.js (compartilhadas com os testes automatizados).
 */
import {
  AUDIO_MODES,
  CODECS,
  DEFAULT_OPTIONS,
  FRAME_RATES,
  QUALITY_LEVELS,
  RESOLUTIONS,
  SPEEDS,
  buildFfmpegArgs,
  formatBytes,
  formatDuration,
  outputFileName,
  resolveCrf,
} from "./compression.js";
import { LIMITE_ZIP, criarZip } from "./zip.js";

const $ = (id) => document.getElementById(id);

const el = {
  motor: $("motor"),
  motorTexto: $("motorTexto"),
  motorBarraCaixa: $("motorBarraCaixa"),
  motorBarra: $("motorBarra"),
  soltar: $("soltar"),
  arquivos: $("arquivos"),
  niveis: $("niveis"),
  blocoQualidade: $("blocoQualidade"),
  blocoTamanho: $("blocoTamanho"),
  blocoCrf: $("blocoCrf"),
  crf: $("crf"),
  crfValor: $("crfValor"),
  tamanhoAlvo: $("tamanhoAlvo"),
  chipsTamanho: $("chipsTamanho"),
  codec: $("codec"),
  dicaCodec: $("dicaCodec"),
  resolucao: $("resolucao"),
  fps: $("fps"),
  audio: $("audio"),
  velocidade: $("velocidade"),
  dicaVelocidade: $("dicaVelocidade"),
  turbo: $("turbo"),
  dicaTurbo: $("dicaTurbo"),
  resumo: $("resumo"),
  comprimir: $("comprimir"),
  baixarTudo: $("baixarTudo"),
  limpar: $("limpar"),
  fila: $("fila"),
  vazio: $("vazio"),
  total: $("total"),
  registro: $("registro"),
  avisoNavegador: $("avisoNavegador"),
};

const CHAVE_OPCOES = "compressor-video:opcoes";
const CHAVE_TURBO = "compressor-video:turbo";
const CHAVE_AVISO_TURBO = "compressor-video:aviso-turbo";
const AVISO_TAMANHO = 500 * 1024 * 1024;

const opcoes = sanear({ ...DEFAULT_OPTIONS, ...lerOpcoesSalvas() });
const fila = [];
let contador = 0;
let processando = false;
let pararPedido = false;

// ---------------------------------------------------------------------------
// Worker do ffmpeg
// ---------------------------------------------------------------------------
let worker = null;
let motorPronto = false;
let motorCarregando = null;
let proximoJob = 0;
const pendentes = new Map();

function baseDoNucleo() {
  const parametro = new URLSearchParams(location.search).get("core");
  return parametro || null; // null = usar o CDN padrao definido no worker
}

function usandoTurbo() {
  return Boolean(el.turbo.checked && self.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined");
}

function criarWorker() {
  worker = new Worker(new URL("./ffmpeg-worker.js", import.meta.url));
  worker.onmessage = (evento) => {
    const dados = evento.data || {};
    if (dados.type === "core-progress") return mostrarDownloadNucleo(dados);
    if (dados.type === "log") return registrar(dados.message);
    if (dados.type === "progress") {
      const pendente = pendentes.get(dados.jobId);
      if (pendente && pendente.onProgress) pendente.onProgress(dados);
      return;
    }
    const pendente = pendentes.get(dados.jobId);
    if (dados.type === "error") {
      if (pendente) {
        pendentes.delete(dados.jobId);
        pendente.reject(new Error(dados.message));
      } else {
        definirMotor("erro", dados.message);
      }
      return;
    }
    if (pendente) {
      pendentes.delete(dados.jobId);
      pendente.resolve(dados);
    }
  };
  worker.onerror = (evento) => {
    const mensagem = evento.message || "Falha inesperada no motor de compressao.";
    for (const [, pendente] of pendentes) pendente.reject(new Error(mensagem));
    pendentes.clear();
    definirMotor("erro", mensagem);
  };
  return worker;
}

function enviar(mensagem, transfer = [], onProgress = null) {
  if (!worker) criarWorker();
  const jobId = mensagem.jobId != null ? mensagem.jobId : `job-${(proximoJob += 1)}`;
  return new Promise((resolve, reject) => {
    pendentes.set(jobId, { resolve, reject, onProgress });
    worker.postMessage(
      { ...mensagem, jobId, coreBase: baseDoNucleo(), multithread: usandoTurbo() },
      transfer,
    );
  });
}

function reiniciarMotor(motivo = "O motor de compressão foi reiniciado.") {
  if (worker) worker.terminate();
  worker = null;
  motorPronto = false;
  motorCarregando = null;
  for (const [, pendente] of pendentes) pendente.reject(new Error(motivo));
  pendentes.clear();
}

function garantirMotor() {
  if (motorPronto) return Promise.resolve();
  if (!motorCarregando) {
    definirMotor("carregando", "Baixando o motor de compressao (acontece só na primeira vez)…");
    motorCarregando = enviar({ type: "load" })
      .then(() => {
        motorPronto = true;
        definirMotor(
          "pronto",
          usandoTurbo()
            ? `Motor pronto — modo turbo com ${navigator.hardwareConcurrency || 4} núcleos`
            : "Motor de compressão pronto",
        );
        el.motorBarraCaixa.hidden = true;
      })
      .catch((erro) => {
        motorCarregando = null;
        if (usandoTurbo()) {
          // O turbo e um acelerador, nao uma dependencia: se ele falhar,
          // desligamos e voltamos ao modo normal em vez de travar o app.
          desistirDoTurbo(erro.message);
          return;
        }
        definirMotor("erro", erro.message);
        throw erro;
      });
  }
  return motorCarregando;
}

function definirMotor(estado, texto) {
  el.motor.dataset.estado = estado;
  el.motorTexto.textContent = texto;
}

function mostrarDownloadNucleo({ label, loaded, total, cached }) {
  if (cached) {
    definirMotor("carregando", "Carregando o motor guardado no navegador…");
    el.motorBarraCaixa.hidden = true;
    return;
  }
  el.motorBarraCaixa.hidden = false;
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  el.motorBarra.style.width = `${pct}%`;
  definirMotor(
    "carregando",
    total
      ? `Baixando ${label}: ${formatBytes(loaded)} de ${formatBytes(total)} (${pct}%)`
      : `Baixando ${label}: ${formatBytes(loaded)}`,
  );
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
function preencherSelect(select, itens, valorAtual) {
  select.innerHTML = "";
  for (const item of itens) {
    const opcao = document.createElement("option");
    opcao.value = String(item.value);
    opcao.textContent = item.label;
    if (item.disabled) opcao.disabled = true;
    select.append(opcao);
  }
  select.value = String(valorAtual);
}

/** Alguns codecs (H.265) so funcionam com o modo turbo ligado. */
function opcoesDeCodec() {
  const turbo = usandoTurbo();
  return Object.values(CODECS).map((codec) => ({
    value: codec.id,
    label: codec.requiresMultithread && !turbo ? `${codec.label} — só com o modo turbo` : codec.label,
    disabled: Boolean(codec.requiresMultithread) && !turbo,
  }));
}

function montarControles() {
  el.niveis.innerHTML = "";
  for (const nivel of Object.values(QUALITY_LEVELS)) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "nivel";
    botao.dataset.nivel = nivel.id;
    botao.setAttribute("aria-pressed", String(opcoes.level === nivel.id));
    botao.innerHTML = `<strong>${nivel.label}</strong><small>${nivel.tagline}</small>`;
    botao.title = nivel.hint;
    botao.addEventListener("click", () => escolherNivel(nivel.id));
    el.niveis.append(botao);
  }

  preencherSelect(el.codec, opcoesDeCodec(), opcoes.codec);
  preencherSelect(el.resolucao, RESOLUTIONS, opcoes.maxHeight);
  preencherSelect(el.fps, FRAME_RATES, opcoes.fps);
  preencherSelect(el.audio, AUDIO_MODES, opcoes.audioBitrate);
  preencherSelect(
    el.velocidade,
    Object.values(SPEEDS).map((s) => ({ value: s.id, label: s.label })),
    opcoes.speed,
  );

  el.tamanhoAlvo.value = String(opcoes.targetSizeMB);
  const faixaInicial = CODECS[opcoes.codec].crfRange;
  el.crf.min = String(faixaInicial.min);
  el.crf.max = String(faixaInicial.max);
  el.crf.value = String(opcoes.crf);

  for (const botao of document.querySelectorAll("[data-modo]")) {
    botao.addEventListener("click", () => {
      opcoes.mode = botao.dataset.modo;
      sincronizar();
    });
  }
  for (const chip of el.chipsTamanho.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
      opcoes.targetSizeMB = Number(chip.dataset.mb);
      el.tamanhoAlvo.value = chip.dataset.mb;
      sincronizar();
    });
  }

  el.codec.addEventListener("change", () => {
    opcoes.codec = el.codec.value;
    const faixa = CODECS[opcoes.codec].crfRange;
    el.crf.min = String(faixa.min);
    el.crf.max = String(faixa.max);
    opcoes.crf = resolveCrf({ ...opcoes, level: "custom", crf: opcoes.crf });
    el.crf.value = String(opcoes.crf);
    sincronizar();
  });
  el.resolucao.addEventListener("change", () => {
    opcoes.maxHeight = Number(el.resolucao.value);
    sincronizar();
  });
  el.fps.addEventListener("change", () => {
    opcoes.fps = Number(el.fps.value);
    sincronizar();
  });
  el.audio.addEventListener("change", () => {
    opcoes.audioBitrate = Number(el.audio.value);
    sincronizar();
  });
  el.velocidade.addEventListener("change", () => {
    opcoes.speed = el.velocidade.value;
    sincronizar();
  });
  el.crf.addEventListener("input", () => {
    opcoes.level = "custom";
    opcoes.crf = Number(el.crf.value);
    sincronizar();
  });
  el.tamanhoAlvo.addEventListener("input", () => {
    opcoes.targetSizeMB = Math.max(1, Number(el.tamanhoAlvo.value) || 1);
    sincronizar();
  });
  el.turbo.addEventListener("change", aoTrocarTurbo);
}

function escolherNivel(id) {
  opcoes.level = id;
  const nivel = QUALITY_LEVELS[id];
  if (nivel.crf) opcoes.crf = nivel.crf[opcoes.codec];
  if (nivel.suggestedMaxHeight !== null && nivel.suggestedMaxHeight !== undefined) {
    opcoes.maxHeight = nivel.suggestedMaxHeight;
    el.resolucao.value = String(opcoes.maxHeight);
  }
  el.crf.value = String(opcoes.crf);
  sincronizar();
}

function sincronizar() {
  if (CODECS[opcoes.codec].requiresMultithread && !usandoTurbo()) {
    opcoes.codec = DEFAULT_OPTIONS.codec;
  }
  preencherSelect(el.codec, opcoesDeCodec(), opcoes.codec);
  const porTamanho = opcoes.mode === "size";
  for (const botao of document.querySelectorAll("[data-modo]")) {
    botao.setAttribute("aria-pressed", String(botao.dataset.modo === opcoes.mode));
  }
  el.blocoQualidade.hidden = porTamanho;
  el.blocoTamanho.hidden = !porTamanho;
  el.blocoCrf.hidden = opcoes.level !== "custom";
  el.crfValor.textContent = String(opcoes.crf);

  for (const botao of el.niveis.querySelectorAll(".nivel")) {
    botao.setAttribute("aria-pressed", String(botao.dataset.nivel === opcoes.level));
  }
  for (const chip of el.chipsTamanho.querySelectorAll(".chip")) {
    chip.setAttribute("aria-pressed", String(Number(chip.dataset.mb) === Number(opcoes.targetSizeMB)));
  }

  el.dicaCodec.textContent = CODECS[opcoes.codec].hint;
  el.dicaVelocidade.textContent = SPEEDS[opcoes.speed].hint;

  const partes = [CODECS[opcoes.codec].label];
  partes.push(porTamanho ? `alvo de ~${opcoes.targetSizeMB} MB por vídeo` : `qualidade ${QUALITY_LEVELS[opcoes.level].label} (CRF ${opcoes.crf})`);
  partes.push(opcoes.maxHeight ? `até ${opcoes.maxHeight}p` : "resolução original");
  if (opcoes.fps) partes.push(`${opcoes.fps} fps`);
  partes.push(opcoes.audioBitrate ? `áudio ${opcoes.audioBitrate} kbps` : "sem áudio");
  partes.push(`compressão ${SPEEDS[opcoes.speed].label.toLowerCase()}`);
  el.resumo.textContent = `Saída: ${partes.join(" • ")}.`;

  salvarOpcoes();
  atualizarBotoes();
}

// ---------------------------------------------------------------------------
// Modo turbo (multi-thread)
// ---------------------------------------------------------------------------
async function aoTrocarTurbo() {
  if (!el.turbo.checked) {
    guardar(CHAVE_TURBO, "0");
    guardar(CHAVE_AVISO_TURBO, "");
    if (motorPronto || motorCarregando) {
      reiniciarMotor("Modo turbo desligado.");
      definirMotor("ocioso", "Modo turbo desligado. O motor será recarregado na próxima compressão.");
    }
    el.dicaTurbo.textContent = "Desligado. A compressão usa um núcleo só e o H.265 fica indisponível.";
    sincronizar();
    return;
  }

  if (self.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined") {
    guardar(CHAVE_TURBO, "1");
    reiniciarMotor("Modo turbo ligado.");
    definirMotor("ocioso", "Modo turbo ligado (H.265 liberado). O motor será recarregado na próxima compressão.");
    el.dicaTurbo.textContent = `Ligado: a compressão usa até ${navigator.hardwareConcurrency || 4} núcleos do seu processador e libera a saída em H.265.`;
    sincronizar();
    return;
  }

  await ligarTurbo(false);
}

/**
 * O modo turbo se liga sozinho na primeira visita. Se o navegador nao aceitar,
 * desiste em silencio e nunca mais tenta — a compressao funciona do mesmo
 * jeito, so mais devagar.
 */
function prepararTurbo() {
  const aviso = ler(CHAVE_AVISO_TURBO);
  if (aviso) guardar(CHAVE_AVISO_TURBO, "");

  const escolha = ler(CHAVE_TURBO); // "1", "0" ou vazio na primeira visita
  const isolado = Boolean(self.crossOriginIsolated) && typeof SharedArrayBuffer !== "undefined";

  if (isolado) {
    el.turbo.checked = escolha !== "0";
    el.dicaTurbo.textContent = `Ligado: a compressão usa até ${navigator.hardwareConcurrency || 4} núcleos do seu processador e libera a saída em H.265.`;
    return;
  }

  el.turbo.checked = false;
  if (aviso) {
    el.dicaTurbo.textContent = aviso;
    return;
  }
  if (escolha === "0") return;
  if (escolha === "1") {
    // tentou na visita anterior e o navegador nao aceitou
    guardar(CHAVE_TURBO, "0");
    el.dicaTurbo.textContent =
      "O modo turbo não funciona neste navegador. A compressão continua normal, só um pouco mais devagar.";
    return;
  }
  ligarTurbo(true);
}

/** Registra o service worker que isola a pagina e recarrega uma unica vez. */
async function ligarTurbo(automatico) {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    guardar(CHAVE_TURBO, "0");
    el.turbo.checked = false;
    el.dicaTurbo.textContent =
      "O modo turbo não está disponível aqui (precisa de HTTPS). A compressão continua funcionando normalmente.";
    return;
  }

  guardar(CHAVE_TURBO, "1");
  el.dicaTurbo.textContent = "Ativando o modo turbo… a página vai recarregar uma vez.";
  if (automatico) definirMotor("carregando", "Preparando o modo turbo…");

  try {
    await navigator.serviceWorker.register(new URL("../coi-serviceworker.js", import.meta.url), { scope: "./" });
    // esperamos o service worker ficar ativo: recarregar antes disso
    // devolveria a mesma pagina sem isolamento
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    if (automatico && fila.length) {
      // A pessoa ja comecou a usar o app: recarregar agora apagaria a fila.
      // Deixamos a escolha em aberto para tentar de novo na proxima visita.
      guardar(CHAVE_TURBO, "");
      el.dicaTurbo.textContent = "O modo turbo será ligado na próxima vez que você abrir o app.";
      definirMotor("ocioso", "Motor de compressão pronto para carregar");
      return;
    }
    location.reload();
  } catch (erro) {
    guardar(CHAVE_TURBO, "0");
    el.turbo.checked = false;
    el.dicaTurbo.textContent = `Não foi possível ativar o modo turbo (${erro.message}). A compressão continua funcionando normalmente.`;
  }
}

/** Desliga o turbo, tira o service worker do caminho e recarrega. */
async function desistirDoTurbo(motivo) {
  guardar(CHAVE_TURBO, "0");
  guardar(
    CHAVE_AVISO_TURBO,
    "O modo turbo não funcionou neste navegador, então voltamos ao modo normal. Pode usar o app à vontade.",
  );
  registrar(`Turbo desligado: ${motivo}`);
  definirMotor("carregando", "Voltando ao modo normal…");
  try {
    const registros = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registros.map((registro) => registro.unregister()));
  } catch {
    /* seguimos mesmo assim */
  }
  location.reload();
}

// ---------------------------------------------------------------------------
// Fila de arquivos
// ---------------------------------------------------------------------------
function ehVideo(file) {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|avi|mkv|webm|wmv|asf|flv|f4v|mpg|mpeg|m2v|ts|mts|m2ts|3gp|3g2|ogv|vob|divx|dv|mxf|rm|rmvb|qt)$/i.test(
    file.name,
  );
}

async function adicionarArquivos(lista) {
  const arquivos = Array.from(lista).filter(ehVideo);
  const ignorados = lista.length - arquivos.length;
  if (ignorados > 0) registrar(`${ignorados} arquivo(s) ignorado(s) por não parecerem vídeo.`);

  for (const file of arquivos) {
    const item = {
      id: (contador += 1),
      file,
      estado: "aguardando",
      meta: null,
      resultado: null,
    };
    fila.push(item);
    desenharItem(item);
  }
  atualizarBotoes();
  atualizarTotais();

  for (const item of fila) {
    if (item.meta === null) {
      item.meta = await lerMetadadosRapido(item.file);
      atualizarMeta(item);
    }
  }
}

function lerMetadadosRapido(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let concluido = false;
    const terminar = (meta) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(limite);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(meta);
    };
    const limite = setTimeout(() => terminar(undefined), 6000);
    video.preload = "metadata";
    video.muted = true;
    video.addEventListener("loadedmetadata", () =>
      terminar({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      }),
    );
    video.addEventListener("error", () => terminar(undefined));
    video.src = url;
  });
}

function desenharItem(item) {
  const li = document.createElement("li");
  li.className = "item";
  li.dataset.id = String(item.id);
  li.innerHTML = `
    <div class="item__topo">
      <span class="item__nome"></span>
      <span class="item__meta"></span>
    </div>
    <div class="item__barra"><div class="item__barra-interna"></div></div>
    <div class="item__estado" data-estado="aguardando"></div>
    <div class="item__acoes"></div>
  `;
  li.querySelector(".item__nome").textContent = item.file.name;
  el.fila.append(li);
  item.no = li;
  item.noMeta = li.querySelector(".item__meta");
  item.noBarra = li.querySelector(".item__barra-interna");
  item.noEstado = li.querySelector(".item__estado");
  item.noAcoes = li.querySelector(".item__acoes");
  atualizarMeta(item);
  definirEstado(item, "aguardando", "Na fila");

  if (item.file.size > AVISO_TAMANHO) {
    definirEstado(
      item,
      "aviso",
      `Arquivo grande (${formatBytes(item.file.size)}). A compressão no navegador pode demorar bastante ou falhar por falta de memória.`,
    );
  }
  el.vazio.hidden = true;
}

function atualizarMeta(item) {
  const partes = [formatBytes(item.file.size)];
  if (item.meta && item.meta.width) partes.push(`${item.meta.width}×${item.meta.height}`);
  if (item.meta && item.meta.duration) partes.push(formatDuration(item.meta.duration));
  item.noMeta.textContent = partes.join(" • ");
}

function definirEstado(item, estado, texto) {
  item.estado = estado;
  item.noEstado.dataset.estado = estado;
  item.noEstado.textContent = texto;
}

function definirProgresso(item, fracao) {
  item.noBarra.style.width = `${Math.max(0, Math.min(100, fracao * 100)).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Compressao
// ---------------------------------------------------------------------------
function interpretarFfprobe(raw) {
  try {
    const dados = JSON.parse(raw);
    const video = (dados.streams || []).find(
      (s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic),
    );
    const audio = (dados.streams || []).find((s) => s.codec_type === "audio");
    const duracao =
      Number(dados.format && dados.format.duration) ||
      Number(video && video.duration) ||
      0;
    if (!video) return null;
    return {
      duration: duracao,
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      hasAudio: Boolean(audio),
      codec: video.codec_name || "",
    };
  } catch {
    return null;
  }
}

function extensao(nome) {
  const ponto = String(nome).lastIndexOf(".");
  return ponto > 0 ? nome.slice(ponto).toLowerCase() : ".bin";
}

async function comprimirItem(item) {
  const inicio = performance.now();
  let ultimoDesenho = 0;
  definirProgresso(item, 0);
  definirEstado(item, "processando", "Lendo o arquivo…");

  const inputName = `entrada-${item.id}${extensao(item.file.name)}`;
  const outputName = outputFileName(item.file.name, opcoes.codec);
  const buffer = await item.file.arrayBuffer();

  definirEstado(item, "processando", "Analisando o vídeo…");
  const analise = await enviar({ type: "prepare", inputName, data: buffer }, [buffer]);
  const meta = interpretarFfprobe(analise.raw) || item.meta || {};
  item.meta = { ...item.meta, ...meta };
  atualizarMeta(item);

  const job = buildFfmpegArgs(
    opcoes,
    { name: item.file.name, size: item.file.size, ...item.meta },
    { inputName, outputName, threads: usandoTurbo() ? navigator.hardwareConcurrency || 4 : 0 },
  );
  for (const aviso of job.warnings) registrar(`${item.file.name}: ${aviso}`);
  registrar(`ffmpeg ${job.args.join(" ")}`);

  const duracao = Number(item.meta.duration) || 0;
  definirEstado(item, "processando", "Comprimindo…");

  const resposta = await enviar(
    { type: "run", args: job.args, inputName, outputName },
    [],
    ({ seconds, ratio }) => {
      const agora = performance.now();
      if (agora - ultimoDesenho < 120) return;
      ultimoDesenho = agora;
      const fracao = duracao ? seconds / duracao : ratio;
      definirProgresso(item, fracao);
      const decorrido = (performance.now() - inicio) / 1000;
      const restante = fracao > 0.02 ? decorrido / fracao - decorrido : 0;
      definirEstado(
        item,
        "processando",
        `Comprimindo… ${Math.round(Math.min(1, fracao) * 100)}%${
          restante > 1 ? ` • faltam cerca de ${formatDuration(restante)}` : ""
        }`,
      );
    },
  );

  const blob = new Blob([resposta.data], { type: job.mime });
  item.resultado = {
    blob,
    url: URL.createObjectURL(blob),
    nome: outputName,
    tamanho: blob.size,
    resumo: job.summary,
    segundos: (performance.now() - inicio) / 1000,
  };
  definirProgresso(item, 1);
  mostrarResultado(item);
}

function mostrarResultado(item) {
  const { resultado } = item;
  const ganho = 1 - resultado.tamanho / item.file.size;
  const classe = ganho >= 0 ? "item__ganho" : "item__ganho item__ganho--negativo";
  definirEstado(
    item,
    "pronto",
    `Pronto em ${formatDuration(resultado.segundos)} — ${formatBytes(item.file.size)} → ${formatBytes(resultado.tamanho)}`,
  );
  const rotulo = ganho >= 0 ? `−${Math.round(ganho * 100)}%` : `+${Math.round(-ganho * 100)}%`;
  const marcador = document.createElement("span");
  marcador.className = classe;
  marcador.textContent = rotulo;
  item.noEstado.append(" ", marcador);

  item.noAcoes.innerHTML = "";
  const baixar = document.createElement("a");
  baixar.className = "botao botao--primario botao--pequeno";
  baixar.href = resultado.url;
  baixar.download = resultado.nome;
  baixar.textContent = "Baixar";
  const prever = document.createElement("button");
  prever.type = "button";
  prever.className = "botao botao--pequeno";
  prever.textContent = "Ver prévia";
  prever.addEventListener("click", () => {
    if (item.noVideo) {
      item.noVideo.remove();
      item.noVideo = null;
      prever.textContent = "Ver prévia";
      return;
    }
    const video = document.createElement("video");
    video.controls = true;
    video.src = resultado.url;
    item.no.append(video);
    item.noVideo = video;
    prever.textContent = "Ocultar prévia";
  });
  const refazer = document.createElement("button");
  refazer.type = "button";
  refazer.className = "botao botao--pequeno botao--discreto";
  refazer.textContent = "Comprimir de novo";
  refazer.title = "Mude as opções no passo 2 e comprima este vídeo outra vez";
  refazer.addEventListener("click", () => {
    URL.revokeObjectURL(resultado.url);
    if (item.noVideo) {
      item.noVideo.remove();
      item.noVideo = null;
    }
    item.resultado = null;
    item.noAcoes.innerHTML = "";
    definirProgresso(item, 0);
    definirEstado(item, "aguardando", "Na fila");
    atualizarBotoes();
    atualizarTotais();
  });
  const detalhe = document.createElement("span");
  detalhe.className = "item__meta";
  detalhe.textContent = resultado.resumo;
  item.noAcoes.append(baixar, prever, refazer, detalhe);
}

/**
 * Uma falha do WebAssembly deixa o motor inutilizavel. Em vez de perder o
 * video, reiniciamos o motor e tentamos mais uma vez.
 */
async function comprimirComRetentativa(item) {
  try {
    await comprimirItem(item);
  } catch (erro) {
    if (pararPedido) throw erro;
    registrar(`Primeira tentativa falhou em ${item.file.name}: ${erro.message}`);
    definirEstado(item, "aviso", "O motor falhou — reiniciando e tentando mais uma vez…");
    definirProgresso(item, 0);
    reiniciarMotor("Motor reiniciado depois de uma falha.");
    await garantirMotor();
    await comprimirItem(item);
  }
}

async function comprimirTudo() {
  if (processando) {
    pararPedido = true;
    reiniciarMotor();
    return;
  }

  const pendentesFila = fila.filter((item) => !item.resultado);
  if (!pendentesFila.length) return;

  processando = true;
  pararPedido = false;
  atualizarBotoes();

  try {
    await garantirMotor();
  } catch {
    processando = false;
    atualizarBotoes();
    return;
  }

  for (const item of pendentesFila) {
    if (pararPedido) {
      definirEstado(item, "aguardando", "Cancelado");
      continue;
    }
    try {
      await comprimirComRetentativa(item);
    } catch (erro) {
      definirProgresso(item, 0);
      if (pararPedido) {
        definirEstado(item, "aviso", "Compressão interrompida por você");
      } else {
        definirEstado(item, "erro", `Não deu certo: ${erro.message}`);
        registrar(`ERRO em ${item.file.name}: ${erro.message}`);
      }
    }
    atualizarTotais();
    atualizarBotoes();
  }

  processando = false;
  pararPedido = false;
  atualizarBotoes();
  atualizarTotais();
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
async function baixarTudo() {
  const prontos = fila.filter((item) => item.resultado);
  if (!prontos.length) return;
  if (prontos.length === 1) {
    dispararDownload(prontos[0].resultado.url, prontos[0].resultado.nome);
    return;
  }

  const total = prontos.reduce((soma, item) => soma + item.resultado.tamanho, 0);
  if (total > LIMITE_ZIP) {
    registrar("Total acima de 4 GB: baixando os arquivos separadamente.");
    for (const item of prontos) dispararDownload(item.resultado.url, item.resultado.nome);
    return;
  }

  const rotuloOriginal = el.baixarTudo.textContent;
  el.baixarTudo.disabled = true;
  try {
    const zip = await criarZip(
      prontos.map((item) => ({ name: item.resultado.nome, blob: item.resultado.blob })),
      (feito, quantos) => {
        el.baixarTudo.textContent = `Montando o .zip (${feito}/${quantos})…`;
      },
    );
    const url = URL.createObjectURL(zip);
    dispararDownload(url, "videos-comprimidos.zip");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (erro) {
    registrar(`ERRO ao montar o zip: ${erro.message}`);
  } finally {
    el.baixarTudo.textContent = rotuloOriginal;
    el.baixarTudo.disabled = false;
  }
}

function dispararDownload(url, nome) {
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
}

function limparFila() {
  for (const item of fila) {
    if (item.resultado) URL.revokeObjectURL(item.resultado.url);
  }
  fila.length = 0;
  el.fila.innerHTML = "";
  el.vazio.hidden = false;
  el.total.hidden = true;
  atualizarBotoes();
}

// ---------------------------------------------------------------------------
// Estado da interface
// ---------------------------------------------------------------------------
function atualizarBotoes() {
  const temPendentes = fila.some((item) => !item.resultado);
  const temProntos = fila.some((item) => item.resultado);
  el.comprimir.disabled = !processando && !temPendentes;
  el.comprimir.textContent = processando ? "Parar" : "Comprimir tudo";
  el.comprimir.classList.toggle("botao--primario", !processando);
  el.baixarTudo.disabled = !temProntos || processando;
  el.limpar.disabled = !fila.length || processando;
  el.turbo.disabled = processando;
}

function atualizarTotais() {
  const prontos = fila.filter((item) => item.resultado);
  if (!prontos.length) {
    el.total.hidden = true;
    return;
  }
  const antes = prontos.reduce((soma, item) => soma + item.file.size, 0);
  const depois = prontos.reduce((soma, item) => soma + item.resultado.tamanho, 0);
  const ganho = Math.round((1 - depois / antes) * 100);
  el.total.hidden = false;
  el.total.textContent = `${prontos.length} vídeo(s) prontos: ${formatBytes(antes)} → ${formatBytes(
    depois,
  )} (${ganho >= 0 ? `economia de ${ganho}%` : `${-ganho}% maior`})`;
}

const linhasPendentes = [];
let descargaAgendada = false;

function registrar(mensagem) {
  linhasPendentes.push(mensagem);
  if (descargaAgendada) return;
  descargaAgendada = true;
  setTimeout(() => {
    descargaAgendada = false;
    if (!linhasPendentes.length) return;
    const texto = `${linhasPendentes.join("\n")}\n`;
    linhasPendentes.length = 0;
    el.registro.textContent = (el.registro.textContent + texto).slice(-40000);
    el.registro.scrollTop = el.registro.scrollHeight;
  }, 400);
}

// ---------------------------------------------------------------------------
// Preferencias salvas
// ---------------------------------------------------------------------------
function ler(chave) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function guardar(chave, valor) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* modo privado: seguimos sem salvar */
  }
}

/** Descarta valores salvos que nao existem mais (codec removido, por exemplo). */
function sanear(valores) {
  const limpo = { ...valores };
  if (!CODECS[limpo.codec]) limpo.codec = DEFAULT_OPTIONS.codec;
  if (!QUALITY_LEVELS[limpo.level]) limpo.level = DEFAULT_OPTIONS.level;
  if (!SPEEDS[limpo.speed]) limpo.speed = DEFAULT_OPTIONS.speed;
  if (limpo.mode !== "size") limpo.mode = "quality";
  return limpo;
}

function lerOpcoesSalvas() {
  try {
    return JSON.parse(ler(CHAVE_OPCOES) || "{}");
  } catch {
    return {};
  }
}

function salvarOpcoes() {
  guardar(CHAVE_OPCOES, JSON.stringify(opcoes));
}

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------
function ligarUpload() {
  el.soltar.addEventListener("click", () => el.arquivos.click());
  el.soltar.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      el.arquivos.click();
    }
  });
  el.arquivos.addEventListener("change", () => {
    adicionarArquivos(el.arquivos.files);
    el.arquivos.value = "";
  });
  for (const evento of ["dragenter", "dragover"]) {
    el.soltar.addEventListener(evento, (e) => {
      e.preventDefault();
      el.soltar.classList.add("ativo");
    });
  }
  for (const evento of ["dragleave", "drop"]) {
    el.soltar.addEventListener(evento, (e) => {
      e.preventDefault();
      el.soltar.classList.remove("ativo");
    });
  }
  el.soltar.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) adicionarArquivos(e.dataTransfer.files);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

function verificarNavegador() {
  if (typeof WebAssembly === "undefined") {
    el.avisoNavegador.hidden = false;
    el.avisoNavegador.textContent =
      "Este navegador não tem suporte a WebAssembly, que é necessário para comprimir vídeos. Use uma versão atual do Chrome, Edge, Firefox ou Safari.";
    el.comprimir.disabled = true;
    return false;
  }
  if (!window.isSecureContext) {
    el.avisoNavegador.hidden = false;
    el.avisoNavegador.textContent =
      "Abra esta página por HTTPS (ou localhost) para que o navegador libere todos os recursos usados na compressão.";
  }
  return true;
}

el.comprimir.addEventListener("click", comprimirTudo);
el.baixarTudo.addEventListener("click", baixarTudo);
el.limpar.addEventListener("click", limparFila);

window.addEventListener("beforeunload", (evento) => {
  if (processando) {
    evento.preventDefault();
    evento.returnValue = "";
  }
});

prepararTurbo();
montarControles();
sincronizar();
ligarUpload();
verificarNavegador();
