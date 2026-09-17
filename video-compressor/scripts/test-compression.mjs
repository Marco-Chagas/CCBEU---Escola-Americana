/**
 * Teste de ponta a ponta das regras de compressao.
 *
 * Gera videos de teste em varios formatos (MP4, MOV, AVI, MKV, WebM), roda o
 * ffmpeg com EXATAMENTE os argumentos que a interface monta e confere o
 * resultado com o ffprobe.
 *
 *   cd video-compressor && npm install && npm test
 */
import { loadCore } from "./core-node.mjs";
import { buildFfmpegArgs, CODECS, outputFileName } from "../assets/compression.js";

const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  const icon = condition ? "✓" : "✗";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SOURCES = [
  {
    name: "aula.mp4",
    label: "MP4 (H.264 + AAC)",
    args: ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"],
  },
  {
    name: "camera.mov",
    label: "MOV (H.264 + AAC)",
    args: ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-f", "mov"],
  },
  {
    name: "antigo.avi",
    label: "AVI (MPEG-4 + MP3)",
    args: ["-c:v", "mpeg4", "-c:a", "libmp3lame", "-f", "avi"],
  },
  {
    name: "gravacao.mkv",
    label: "MKV (H.264 + AAC)",
    args: ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-f", "matroska"],
  },
  {
    name: "web.webm",
    label: "WebM (VP8 + Vorbis)",
    args: ["-c:v", "libvpx", "-b:v", "600k", "-cpu-used", "8", "-c:a", "libvorbis", "-f", "webm"],
  },
  {
    name: "mudo.mp4",
    label: "MP4 sem audio",
    noAudio: true,
    args: ["-c:v", "libx264", "-preset", "ultrafast"],
  },
];

function parseRate(rate) {
  const [num, den] = String(rate || "0/1").split("/").map(Number);
  return den ? num / den : num;
}

function describeStreams(info) {
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");
  return {
    video,
    audio,
    duration: Number(info.format.duration) || 0,
    size: Number(info.format.size) || 0,
  };
}

const ff = await loadCore();
console.log("Nucleo ffmpeg.wasm carregado.\n");

// ---------------------------------------------------------------------------
console.log("1) Gerando os videos de teste");
for (const source of SOURCES) {
  const args = [
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
    ...(source.noAudio ? [] : ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"]),
    "-t", "4",
    ...source.args,
    ...(source.noAudio ? [] : ["-shortest"]),
    "-y", source.name,
  ];
  const code = ff.exec(...args);
  const size = code === 0 ? ff.core.FS.stat(source.name).size : 0;
  check(`${source.label} gerado`, code === 0 && size > 0, `${(size / 1024).toFixed(0)} KB`);
  source.info = describeStreams(ff.probe(source.name));
  source.size = size;
}

// ---------------------------------------------------------------------------
console.log("\n2) Cada formato de entrada comprime para MP4/H.264");
for (const source of SOURCES) {
  const job = buildFfmpegArgs(
    { codec: "h264", level: "forte", maxHeight: 480, speed: "rapida" },
    {
      name: source.name,
      duration: source.info.duration,
      width: 640,
      height: 360,
      hasAudio: Boolean(source.info.audio),
    },
    { inputName: source.name, outputName: outputFileName(source.name, "h264") },
  );
  const code = ff.exec(...job.args);
  if (code !== 0) {
    check(`${source.label} → MP4`, false, ff.lastLogs().split("\n").slice(-3).join(" | "));
    continue;
  }
  const out = describeStreams(ff.probe(job.outputName));
  check(
    `${source.label} → MP4`,
    out.video && out.video.codec_name === "h264" && out.size > 0 && Math.abs(out.duration - 4) < 0.6,
    `${out.video.width}x${out.video.height}, ${(out.size / 1024).toFixed(0)} KB, ` +
      `${out.audio ? out.audio.codec_name : "sem audio"}`,
  );
  check(
    `${source.label} → nunca aumenta a resolucao (360p pedido 480p)`,
    out.video.height === 360,
    `altura final ${out.video.height}`,
  );
  ff.core.FS.unlink(job.outputName);
}

// ---------------------------------------------------------------------------
console.log("\n3) Todos os codecs de saida funcionam");
// Clipe pequeno de proposito: H.265 e VP9 sao MUITO lentos em WebAssembly.
{
  const code = ff.exec(
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", "amostra.mp4",
  );
  check("Clipe curto para o teste de codecs", code === 0);
}
const EXPECTED_CODEC = { h264: "h264", vp8: "vp8" };
for (const codecId of Object.keys(CODECS)) {
  if (CODECS[codecId].requiresMultithread) {
    // Sem multi-thread o codec cai para H.264 de proposito: e isso que testamos,
    // porque rodar o x265 em thread unica trava o ffmpeg.
    const semTurbo = buildFfmpegArgs(
      { codec: codecId },
      { name: "amostra.mp4", duration: 2, width: 320, height: 180, hasAudio: true },
      { inputName: "amostra.mp4", outputName: "fallback.mp4", threads: 0 },
    );
    const comTurbo = buildFfmpegArgs(
      { codec: codecId },
      { name: "amostra.mp4", duration: 2, width: 320, height: 180, hasAudio: true },
      { inputName: "amostra.mp4", outputName: "turbo.mp4", threads: 4 },
    );
    check(
      `${CODECS[codecId].label} cai para H.264 sem o modo turbo`,
      semTurbo.codec === "h264" && semTurbo.warnings.length > 0 &&
        comTurbo.args.includes("libx265") && comTurbo.args.includes("-threads"),
      semTurbo.warnings[0],
    );
    continue;
  }
  const job = buildFfmpegArgs(
    { codec: codecId, level: "extrema", maxHeight: 180, speed: "rapida", audioBitrate: 64 },
    { name: "amostra.mp4", duration: 2, width: 320, height: 180, hasAudio: true },
    { inputName: "amostra.mp4", outputName: `saida-${codecId}.${CODECS[codecId].ext}` },
  );
  const inicio = Date.now();
  const code = ff.exec(...job.args);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  if (code !== 0) {
    check(`${CODECS[codecId].label}`, false, ff.lastLogs().split("\n").slice(-3).join(" | "));
    continue;
  }
  const out = describeStreams(ff.probe(job.outputName));
  check(
    `${CODECS[codecId].label}`,
    out.video.codec_name === EXPECTED_CODEC[codecId] && out.audio && out.size > 0,
    `${out.video.codec_name} + ${out.audio ? out.audio.codec_name : "?"}, ${(out.size / 1024).toFixed(0)} KB, ${segundos}s`,
  );
  ff.core.FS.unlink(job.outputName);
}

// ---------------------------------------------------------------------------
console.log("\n4) Opcoes da interface");
{
  const base = { name: "aula.mp4", duration: 4, width: 640, height: 360, hasAudio: true };

  // remover audio
  let job = buildFfmpegArgs(
    { codec: "h264", audioBitrate: 0, speed: "rapida" },
    base,
    { inputName: "aula.mp4", outputName: "sem-audio.mp4" },
  );
  check("Remover o audio", ff.exec(...job.args) === 0 && !describeStreams(ff.probe("sem-audio.mp4")).audio);
  ff.core.FS.unlink("sem-audio.mp4");

  // reduzir resolucao e fps
  job = buildFfmpegArgs(
    { codec: "h264", maxHeight: 240, fps: 15, speed: "rapida" },
    base,
    { inputName: "aula.mp4", outputName: "pequeno.mp4" },
  );
  const small = ff.exec(...job.args) === 0 ? describeStreams(ff.probe("pequeno.mp4")) : null;
  check(
    "Reduzir para 240p e 15 fps",
    small && small.video.height === 240 && small.video.width % 2 === 0 && parseRate(small.video.r_frame_rate) === 15,
    small ? `${small.video.width}x${small.video.height} @ ${small.video.r_frame_rate}` : "falhou",
  );
  ff.core.FS.unlink("pequeno.mp4");

  // niveis de qualidade produzem arquivos progressivamente menores
  const sizes = {};
  for (const level of ["leve", "equilibrado", "forte", "extrema"]) {
    const levelJob = buildFfmpegArgs(
      { codec: "h264", level, maxHeight: 0, speed: "rapida" },
      base,
      { inputName: "aula.mp4", outputName: `nivel-${level}.mp4` },
    );
    if (ff.exec(...levelJob.args) === 0) {
      sizes[level] = ff.core.FS.stat(levelJob.outputName).size;
      ff.core.FS.unlink(levelJob.outputName);
    }
  }
  check(
    "Leve > Equilibrado > Forte > Extrema (em tamanho)",
    sizes.leve > sizes.equilibrado && sizes.equilibrado > sizes.forte && sizes.forte > sizes.extrema,
    Object.entries(sizes)
      .map(([k, v]) => `${k}: ${(v / 1024).toFixed(0)} KB`)
      .join(", "),
  );

  // modo "tamanho alvo"
  const targetMB = 0.4;
  job = buildFfmpegArgs(
    { codec: "h264", mode: "size", targetSizeMB: targetMB, maxHeight: 0, speed: "rapida", audioBitrate: 64 },
    base,
    { inputName: "aula.mp4", outputName: "alvo.mp4" },
  );
  const targetOk = ff.exec(...job.args) === 0;
  const finalSize = targetOk ? ff.core.FS.stat("alvo.mp4").size / (1024 * 1024) : 0;
  check(
    `Tamanho alvo de ${targetMB} MB`,
    targetOk && finalSize > targetMB * 0.6 && finalSize < targetMB * 1.35,
    `${finalSize.toFixed(2)} MB (bitrate ${job.videoBitrateKbps} kbps)`,
  );
  if (targetOk) ff.core.FS.unlink("alvo.mp4");

  // video sem audio nao quebra quando o usuario pede audio
  job = buildFfmpegArgs(
    { codec: "h264", audioBitrate: 128, speed: "rapida" },
    { name: "mudo.mp4", duration: 4, width: 640, height: 360, hasAudio: false },
    { inputName: "mudo.mp4", outputName: "mudo-out.mp4" },
  );
  check("Entrada sem audio nao quebra", ff.exec(...job.args) === 0 && job.warnings.length > 0);
  ff.core.FS.unlink("mudo-out.mp4");
}

// ---------------------------------------------------------------------------
console.log("\n5) Compressao realmente reduz o tamanho");
{
  const original = ff.core.FS.stat("aula.mp4").size;
  const job = buildFfmpegArgs(
    { codec: "h264", level: "forte", maxHeight: 360, speed: "rapida" },
    { name: "aula.mp4", duration: 4, width: 640, height: 360, hasAudio: true },
    { inputName: "aula.mp4", outputName: "final.mp4" },
  );
  const ok = ff.exec(...job.args) === 0;
  const compressed = ok ? ff.core.FS.stat("final.mp4").size : original;
  check(
    "Arquivo final menor que o original",
    compressed < original,
    `${(original / 1024).toFixed(0)} KB → ${(compressed / 1024).toFixed(0)} KB ` +
      `(-${Math.round((1 - compressed / original) * 100)}%)`,
  );
}

console.log(`\n${results.length - failures}/${results.length} verificacoes passaram.`);
process.exit(failures ? 1 : 0);
