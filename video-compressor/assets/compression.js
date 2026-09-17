/**
 * Regras de compressao compartilhadas entre a interface (navegador) e os
 * testes automatizados (Node). Este arquivo nao usa nenhuma API do DOM:
 * ele apenas transforma "opcoes escolhidas pelo usuario" em "argumentos de
 * linha de comando do ffmpeg".
 */

/**
 * Codecs/formatos de saida oferecidos na interface.
 *
 * Só entram aqui codificadores testados no build WebAssembly do ffmpeg
 * (@ffmpeg/core 0.12), no Chromium e no Node:
 *   - H.264 e VP8 funcionam sempre;
 *   - H.265 so funciona no modo turbo (multi-thread). No build de thread
 *     unica o x265 trava logo depois de criar o "thread pool", por isso ele
 *     e marcado com requiresMultithread e cai para H.264 automaticamente;
 *   - VP9 (libvpx-vp9) ficou de fora: estoura a memoria do WebAssembly
 *     ("memory access out of bounds") e derruba a aba do navegador.
 */
export const CODECS = {
  h264: {
    id: "h264",
    label: "MP4 / H.264",
    ext: "mp4",
    mime: "video/mp4",
    hint: "Recomendado: compressao rapida e abre em qualquer player, celular, TV e editor.",
    crfRange: { min: 16, max: 40 },
  },
  h265: {
    id: "h265",
    label: "MP4 / H.265 (HEVC)",
    ext: "mp4",
    mime: "video/mp4",
    hint: "Arquivos bem menores que o H.264 na mesma qualidade. Precisa do modo turbo ligado.",
    crfRange: { min: 20, max: 44 },
    requiresMultithread: true,
  },
  vp8: {
    id: "vp8",
    label: "WebM / VP8",
    ext: "webm",
    mime: "video/webm",
    hint: "Formato aberto, bom para publicar na web. Comprime menos que o H.264 e nao abre em players antigos.",
    crfRange: { min: 4, max: 45 },
  },
};

/** Niveis de compressao por qualidade (CRF) para cada codec. */
export const QUALITY_LEVELS = {
  leve: {
    id: "leve",
    label: "Leve",
    tagline: "Qualidade quase intacta",
    hint: "Reduz pouco o tamanho. Bom para arquivo/masterizacao.",
    suggestedMaxHeight: 0,
    crf: { h264: 20, h265: 24, vp8: 8 },
  },
  equilibrado: {
    id: "equilibrado",
    label: "Equilibrado",
    tagline: "Recomendado",
    hint: "Boa qualidade com uma reducao grande de tamanho.",
    suggestedMaxHeight: 1080,
    crf: { h264: 25, h265: 28, vp8: 14 },
  },
  forte: {
    id: "forte",
    label: "Forte",
    tagline: "Arquivo bem menor",
    hint: "Perda visivel em cenas com muito movimento, mas otimo para enviar por e-mail/WhatsApp.",
    suggestedMaxHeight: 720,
    crf: { h264: 29, h265: 32, vp8: 22 },
  },
  extrema: {
    id: "extrema",
    label: "Extrema",
    tagline: "Menor tamanho possivel",
    hint: "Qualidade claramente reduzida. Use para previas, rascunhos e envio rapido.",
    suggestedMaxHeight: 480,
    crf: { h264: 33, h265: 36, vp8: 32 },
  },
  custom: {
    id: "custom",
    label: "Personalizado",
    tagline: "Voce escolhe o CRF",
    hint: "CRF menor = mais qualidade e arquivo maior. CRF maior = arquivo menor.",
    suggestedMaxHeight: null,
    crf: null,
  },
};

/** Velocidade de codificacao (troca tempo de processamento por compressao). */
export const SPEEDS = {
  rapida: {
    id: "rapida",
    label: "Rapida",
    hint: "Termina antes, arquivo um pouco maior.",
    x264: "veryfast",
    x265: "ultrafast",
    vpxCpuUsed: { vp8: 5 },
  },
  equilibrada: {
    id: "equilibrada",
    label: "Equilibrada",
    hint: "Padrao recomendado.",
    x264: "faster",
    x265: "veryfast",
    vpxCpuUsed: { vp8: 3 },
  },
  lenta: {
    id: "lenta",
    label: "Lenta",
    hint: "Demora bem mais e entrega o menor arquivo.",
    x264: "medium",
    x265: "fast",
    vpxCpuUsed: { vp8: 1 },
  },
};

export const RESOLUTIONS = [
  { value: 0, label: "Manter original" },
  { value: 2160, label: "4K (2160p)" },
  { value: 1440, label: "1440p" },
  { value: 1080, label: "Full HD (1080p)" },
  { value: 720, label: "HD (720p)" },
  { value: 480, label: "480p" },
  { value: 360, label: "360p" },
];

export const FRAME_RATES = [
  { value: 0, label: "Manter original" },
  { value: 60, label: "60 fps" },
  { value: 30, label: "30 fps" },
  { value: 24, label: "24 fps" },
  { value: 15, label: "15 fps" },
];

export const AUDIO_MODES = [
  { value: 192, label: "Alta (192 kbps)" },
  { value: 128, label: "Padrao (128 kbps)" },
  { value: 96, label: "Economica (96 kbps)" },
  { value: 64, label: "Minima (64 kbps)" },
  { value: 0, label: "Remover o audio" },
];

/** Motores de compressao disponiveis. */
export const ENGINES = [
  {
    value: "auto",
    label: "Automático (recomendado)",
    hint: "Usa a aceleração por hardware quando o navegador e o arquivo permitem; nos outros casos, o motor completo.",
  },
  {
    value: "ffmpeg",
    label: "Completo (ffmpeg)",
    hint: "Mais lento, porém aceita todos os formatos e respeita o CRF exato. Use se algum vídeo sair estranho.",
  },
];

/** Opcoes iniciais da interface. */
export const DEFAULT_OPTIONS = {
  engine: "auto",
  mode: "quality", // "quality" (CRF) ou "size" (tamanho alvo)
  level: "equilibrado",
  crf: 25,
  targetSizeMB: 25,
  codec: "h264",
  maxHeight: 1080,
  fps: 0,
  audioBitrate: 128,
  speed: "equilibrada",
};

/** Teto de bitrate usado pelo VP8, que precisa de um limite explicito. */
function vp8BitrateCeilingKbps(height) {
  const h = height || 1080;
  if (h <= 360) return 900;
  if (h <= 480) return 1500;
  if (h <= 720) return 2800;
  if (h <= 1080) return 5000;
  return 12000;
}

/** CRF efetivo para a combinacao nivel + codec escolhida. */
export function resolveCrf(options) {
  const codec = CODECS[options.codec] ? options.codec : DEFAULT_OPTIONS.codec;
  const level = QUALITY_LEVELS[options.level] ? options.level : DEFAULT_OPTIONS.level;
  const range = CODECS[codec].crfRange;
  const raw = level === "custom" ? Number(options.crf) : QUALITY_LEVELS[level].crf[codec];
  const value = Number.isFinite(raw) ? raw : QUALITY_LEVELS.equilibrado.crf[codec];
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Altura final do video depois da regra "nunca aumentar a resolucao". */
export function resolveOutputHeight(options, source) {
  const target = Number(options.maxHeight) || 0;
  if (!target) return source && source.height ? source.height : 0;
  if (source && source.height) return Math.min(target, source.height);
  return target;
}

/** Nome do arquivo de saida, preservando o nome original. */
export function outputFileName(inputName, codecId, suffix = "comprimido") {
  const codec = CODECS[codecId] || CODECS.h264;
  const base = String(inputName || "video").replace(/\.[^./\\]+$/, "") || "video";
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  return `${safe}-${suffix}.${codec.ext}`;
}

/** Bitrate de video (kbps) necessario para chegar perto do tamanho alvo. */
export function bitrateForTargetSize(targetSizeMB, durationSeconds, audioBitrate) {
  const totalKbit = Number(targetSizeMB) * 8 * 1024;
  const overhead = 0.985; // container, indices, arredondamentos
  const audioKbps = Number(audioBitrate) > 0 ? Number(audioBitrate) : 0;
  const videoKbps = Math.floor((totalKbit * overhead) / durationSeconds) - audioKbps;
  return Math.max(80, videoKbps);
}

/**
 * Monta a linha de comando do ffmpeg.
 *
 * @param {object} options  opcoes escolhidas na interface
 * @param {object} source   { name, duration, width, height, size, hasAudio }
 * @param {object} [extra]  { inputName, outputName, threads }
 * @returns {{args: string[], inputName: string, outputName: string, mime: string,
 *            codec: string, crf: number|null, videoBitrateKbps: number|null,
 *            outputHeight: number, warnings: string[], summary: string}}
 */
export function buildFfmpegArgs(options, source = {}, extra = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let codecId = CODECS[opts.codec] ? opts.codec : DEFAULT_OPTIONS.codec;
  const threads = Number(extra.threads) || 0;
  const precisaTurbo = CODECS[codecId].requiresMultithread && threads < 2;
  const codec = CODECS[precisaTurbo ? DEFAULT_OPTIONS.codec : codecId];
  const speed = SPEEDS[opts.speed] || SPEEDS.equilibrada;
  const warnings = [];
  if (precisaTurbo) {
    warnings.push(
      `${CODECS[codecId].label} so funciona com o modo turbo ligado; este video foi convertido em ${CODECS[DEFAULT_OPTIONS.codec].label}.`,
    );
    codecId = DEFAULT_OPTIONS.codec;
    opts.codec = codecId; // para o CRF sair na escala certa do codec usado
  }

  const inputName = extra.inputName || "entrada";
  const outputName = extra.outputName || outputFileName(source.name || inputName, codecId);

  const audioBitrate = Number(opts.audioBitrate) || 0;
  const keepAudio = audioBitrate > 0 && source.hasAudio !== false;
  if (audioBitrate > 0 && source.hasAudio === false) {
    warnings.push("O arquivo original nao tem faixa de audio.");
  }

  const duration = Number(source.duration) > 0 ? Number(source.duration) : 0;
  let mode = opts.mode === "size" ? "size" : "quality";
  if (mode === "size" && !duration) {
    mode = "quality";
    warnings.push(
      "Nao foi possivel ler a duracao do video, entao o modo 'tamanho alvo' foi trocado por qualidade (CRF).",
    );
  }

  const outputHeight = resolveOutputHeight(opts, source);
  if (Number(opts.maxHeight) && source.height && source.height < Number(opts.maxHeight)) {
    warnings.push(
      `O video original tem ${source.height}p, menor que a resolucao escolhida. A resolucao original sera mantida (nunca aumentamos a imagem).`,
    );
  }

  // ---- filtros de video -------------------------------------------------
  const filters = [];
  if (Number(opts.maxHeight)) {
    // min(altura escolhida, altura original) garante que nunca ha upscale;
    // -2 mantem a proporcao e forca largura par (exigido pelos codecs).
    filters.push(`scale=-2:'min(${Number(opts.maxHeight)},ih)'`);
  }
  if (Number(opts.fps)) filters.push(`fps=${Number(opts.fps)}`);

  // ---- argumentos -------------------------------------------------------
  const args = ["-i", inputName, "-map", "0:v:0"];
  if (keepAudio) args.push("-map", "0:a:0?");

  if (filters.length) args.push("-vf", filters.join(","));

  let crf = null;
  let videoBitrateKbps = null;

  if (mode === "size") {
    videoBitrateKbps = bitrateForTargetSize(opts.targetSizeMB, duration, keepAudio ? audioBitrate : 0);
  } else {
    crf = resolveCrf(opts);
  }

  if (codecId === "h264" || codecId === "h265") {
    const h264 = codecId === "h264";
    args.push("-c:v", h264 ? "libx264" : "libx265");
    args.push("-preset", h264 ? speed.x264 : speed.x265);
    if (mode === "size") {
      args.push(
        "-b:v",
        `${videoBitrateKbps}k`,
        "-maxrate",
        `${Math.round(videoBitrateKbps * 1.45)}k`,
        "-bufsize",
        `${videoBitrateKbps * 2}k`,
      );
    } else {
      args.push("-crf", String(crf));
    }
    if (codecId === "h265") args.push("-tag:v", "hvc1");
    args.push("-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "libvpx");
    args.push("-cpu-used", String(speed.vpxCpuUsed[codecId]), "-deadline", "good");
    if (mode === "size") {
      args.push("-b:v", `${videoBitrateKbps}k`);
    } else {
      // o VP8 exige um teto de bitrate junto com o CRF
      args.push("-crf", String(crf), "-b:v", `${vp8BitrateCeilingKbps(outputHeight)}k`);
    }
    args.push("-pix_fmt", "yuv420p");
  }

  if (threads > 1) args.push("-threads", String(threads));

  if (keepAudio) {
    const webm = codec.ext === "webm";
    args.push("-c:a", webm ? "libopus" : "aac");
    args.push("-b:a", `${audioBitrate}k`);
    // "-ac 2" com o libopus derruba o ffmpeg.wasm ("memory access out of
    // bounds"), entao a mixagem para estereo so e forcada no AAC.
    if (!webm) args.push("-ac", "2");
  } else {
    args.push("-an");
  }

  if (codec.ext === "mp4") args.push("-movflags", "+faststart");
  args.push("-y", outputName);

  return {
    args,
    inputName,
    outputName,
    mime: codec.mime,
    codec: codecId,
    crf,
    videoBitrateKbps,
    outputHeight,
    warnings,
    summary: describeJob(opts, { crf, videoBitrateKbps, outputHeight, mode, codecId, audioBitrate: keepAudio ? audioBitrate : 0 }),
  };
}

function describeJob(opts, info) {
  const parts = [CODECS[info.codecId].label];
  parts.push(info.mode === "size" ? `alvo ~${opts.targetSizeMB} MB (${info.videoBitrateKbps} kbps)` : `CRF ${info.crf}`);
  parts.push(info.outputHeight ? `${info.outputHeight}p` : "resolucao original");
  if (Number(opts.fps)) parts.push(`${opts.fps} fps`);
  parts.push(info.audioBitrate ? `audio ${info.audioBitrate} kbps` : "sem audio");
  return parts.join(" • ");
}

/** Le a duracao ("Duration: 00:01:23.45") das mensagens de log do ffmpeg. */
export function parseDurationFromLog(line) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}\.\d+)/.exec(line);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Le resolucao e presenca de audio das mensagens de log do ffmpeg. */
export function parseStreamInfoFromLog(line) {
  const info = {};
  if (/Stream #\d+:\d+.*: Video:/.test(line)) {
    const size = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(line);
    if (size) {
      info.width = Number(size[1]);
      info.height = Number(size[2]);
    }
    const fps = /([\d.]+)\s+fps/.exec(line);
    if (fps) info.fps = Number(fps[1]);
    info.hasVideo = true;
  }
  if (/Stream #\d+:\d+.*: Audio:/.test(line)) info.hasAudio = true;
  return Object.keys(info).length ? info : null;
}

/** Formata bytes em KB/MB/GB. */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Formata segundos em h:mm:ss / m:ss. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Motor de hardware (WebCodecs)
//
// O ffmpeg trabalha com CRF ("qualidade alvo"); o codificador do hardware
// trabalha com bitrate ("tamanho por segundo"). As funcoes abaixo traduzem as
// mesmas opcoes da interface para essa outra linguagem, para que o resultado
// fique parecido nos dois motores.
// ---------------------------------------------------------------------------

/** Nome de cada codec no mediabunny. */
const CODEC_HARDWARE = { h264: "avc", h265: "hevc", vp8: "vp8" };

/** Eficiencia relativa ao H.264: o H.265 entrega o mesmo com menos bitrate. */
const EFICIENCIA = { h264: 1, h265: 0.65, vp8: 1.25 };

/**
 * Bits por pixel de referencia do H.264 no nivel "equilibrado" (CRF 25).
 * Cada 6 pontos de CRF dobram ou reduzem pela metade o bitrate, que e a
 * mesma regra pratica usada pelo x264.
 */
const BPP_REFERENCIA = 0.08;
const CRF_REFERENCIA = 25;

/** Bitrate de video (bits por segundo) equivalente a um CRF. */
export function bitrateParaCrf(crf, largura, altura, fps, codecId) {
  const pixels = Math.max(1, largura * altura);
  const quadros = Number(fps) > 0 ? Number(fps) : 30;
  const bpp = BPP_REFERENCIA * Math.pow(2, (CRF_REFERENCIA - crf) / 6);
  const eficiencia = EFICIENCIA[codecId] || 1;
  const bruto = pixels * quadros * bpp * eficiencia;
  // limites de sanidade: nem 100 kbps num 4K, nem 50 Mbps num 360p
  return Math.round(Math.min(Math.max(bruto, 150_000), 60_000_000));
}

/**
 * Traduz as opcoes da interface para o formato do mediabunny.
 *
 * @param {object} options opcoes escolhidas na interface
 * @param {object} source  { name, duration, width, height, fps, hasAudio }
 * @returns opcoes do motor de hardware, ou null quando o codec nao tem
 *          equivalente (ai a interface usa o motor completo)
 */
export function buildHardwareJob(options, source = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const codecId = CODECS[opts.codec] ? opts.codec : DEFAULT_OPTIONS.codec;
  const codec = CODECS[codecId];
  const videoCodec = CODEC_HARDWARE[codecId];
  if (!videoCodec) return null;

  const alturaOriginal = Number(source.height) || 0;
  const larguraOriginal = Number(source.width) || 0;
  const altura = resolveOutputHeight(opts, source);
  const escala = alturaOriginal && altura ? altura / alturaOriginal : 1;
  const largura = larguraOriginal ? Math.round((larguraOriginal * escala) / 2) * 2 : 0;

  const fpsOriginal = Number(source.fps) || 30;
  const fps = Number(opts.fps) ? Math.min(Number(opts.fps), fpsOriginal) : 0;

  const audioBitrate = Number(opts.audioBitrate) || 0;
  const manterAudio = audioBitrate > 0 && source.hasAudio !== false;

  const duracao = Number(source.duration) || 0;
  const porTamanho = opts.mode === "size" && duracao > 0;

  const videoBitrate = porTamanho
    ? bitrateForTargetSize(opts.targetSizeMB, duracao, manterAudio ? audioBitrate : 0) * 1000
    : bitrateParaCrf(resolveCrf(opts), largura || 1280, altura || 720, fps || fpsOriginal, codecId);

  return {
    container: codec.ext === "webm" ? "webm" : "mp4",
    mime: codec.mime,
    videoCodec,
    audioCodec: codec.ext === "webm" ? "opus" : "aac",
    largura: largura || undefined,
    altura: altura || undefined,
    fps: fps || undefined,
    videoBitrate,
    audioBitrate: manterAudio ? audioBitrate * 1000 : 0,
    manterAudio,
    outputName: outputFileName(source.name || "video", codecId),
    codec: codecId,
    summary: `${codec.label} • ${
      porTamanho ? `alvo ~${opts.targetSizeMB} MB` : `qualidade ${QUALITY_LEVELS[opts.level].label}`
    } • ${altura ? `${altura}p` : "resolução original"} • ${Math.round(videoBitrate / 1000)} kbps${
      manterAudio ? ` • áudio ${audioBitrate} kbps` : " • sem áudio"
    }`,
  };
}
