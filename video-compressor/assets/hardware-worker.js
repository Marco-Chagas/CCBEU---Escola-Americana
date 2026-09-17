/**
 * Motor de hardware.
 *
 * Usa a WebCodecs — a API que dá acesso ao codificador de vídeo do próprio
 * computador (placa de vídeo ou chip do processador) — através da biblioteca
 * mediabunny, que cuida de ler o arquivo de entrada e montar o de saída.
 *
 * É muito mais rápido que o ffmpeg.wasm, mas não aceita tudo: formatos antigos
 * (AVI, WMV, FLV) e codecs que o navegador não sabe decodificar continuam indo
 * para o motor completo. Toda mensagem daqui é uma resposta ao app, que decide
 * qual motor usar.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "../vendor/mediabunny/mediabunny.min.mjs";

let conversaoAtual = null;

function post(mensagem, transfer) {
  self.postMessage(mensagem, transfer || []);
}

/** O que este navegador consegue codificar por hardware. */
async function capacidades() {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return { disponivel: false, motivo: "Este navegador não tem a API WebCodecs." };
  }
  const [h264, h265, vp8, aac, opus] = await Promise.all([
    canEncodeVideo("avc").catch(() => false),
    canEncodeVideo("hevc").catch(() => false),
    canEncodeVideo("vp8").catch(() => false),
    canEncodeAudio("aac").catch(() => false),
    canEncodeAudio("opus").catch(() => false),
  ]);
  return {
    disponivel: h264 || h265 || vp8,
    video: { h264, h265, vp8 },
    audio: { aac, opus },
  };
}

/** Abre o arquivo e descreve o que tem dentro. */
async function analisar(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const formato = await input.getFormat(); // lança quando o formato não é reconhecido
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error("O arquivo não tem faixa de vídeo.");

  const [largura, altura, decodifica, audio] = await Promise.all([
    video.getDisplayWidth(),
    video.getDisplayHeight(),
    video.canDecode(),
    input.getPrimaryAudioTrack(),
  ]);

  let duracao = 0;
  try {
    duracao = await input.computeDuration();
  } catch {
    /* alguns arquivos não dizem a duração; seguimos sem ela */
  }

  let fps = 0;
  try {
    fps = (await video.computePacketStats(60)).averagePacketRate || 0;
  } catch {
    /* estatística é opcional */
  }

  return {
    input,
    meta: {
      formato: formato.name,
      width: largura,
      height: altura,
      duration: duracao,
      fps: Math.round(fps) || 0,
      hasAudio: Boolean(audio),
      codec: video.codec || "",
      decodifica,
    },
  };
}

function formatoDeSaida(job) {
  if (job.container === "webm") return new WebMOutputFormat();
  // "in-memory" coloca o índice no começo do arquivo (o mesmo que o
  // +faststart do ffmpeg): o vídeo já começa a tocar durante o download.
  return new Mp4OutputFormat({ fastStart: "in-memory" });
}

async function comprimir({ jobId, file, job }) {
  const { input, meta } = await analisar(file);
  if (!meta.decodifica) {
    throw Object.assign(new Error(`O navegador não sabe decodificar ${meta.codec || "este vídeo"}.`), {
      incompativel: true,
    });
  }

  const output = new Output({ format: formatoDeSaida(job), target: new BufferTarget() });
  const conversao = await Conversion.init({
    input,
    output,
    video: {
      codec: job.videoCodec,
      // passando só a altura, a largura sai pela proporção original
      ...(job.altura ? { height: job.altura } : {}),
      ...(job.fps ? { frameRate: job.fps } : {}),
      bitrate: job.videoBitrate,
      forceTranscode: true,
    },
    audio: job.manterAudio
      ? { codec: job.audioCodec, bitrate: job.audioBitrate, forceTranscode: true }
      : { discard: true },
    showWarnings: false,
  });

  if (!conversao.isValid) {
    const motivos = conversao.discardedTracks.map((t) => t.reason).join(", ");
    throw Object.assign(new Error(`Não dá para converter este arquivo por hardware (${motivos}).`), {
      incompativel: true,
    });
  }

  conversaoAtual = conversao;
  conversao.onProgress = (fracao, segundos) => {
    post({ type: "progress", jobId, ratio: fracao, seconds: segundos });
  };
  await conversao.execute();
  conversaoAtual = null;

  const buffer = output.target.buffer;
  if (!buffer || !buffer.byteLength) throw new Error("A conversão por hardware não gerou nenhum dado.");
  post({ type: "done", jobId, data: buffer, size: buffer.byteLength, meta }, [buffer]);
}

self.onmessage = async (evento) => {
  const dados = evento.data || {};
  try {
    if (dados.type === "capacidades") {
      post({ type: "capacidades", jobId: dados.jobId, ...(await capacidades()) });
      return;
    }
    if (dados.type === "analisar") {
      const { meta } = await analisar(dados.file);
      post({ type: "analisado", jobId: dados.jobId, meta });
      return;
    }
    if (dados.type === "run") {
      await comprimir(dados);
      return;
    }
    throw new Error(`Mensagem desconhecida: ${dados.type}`);
  } catch (erro) {
    conversaoAtual = null;
    post({
      type: "error",
      jobId: dados.jobId || null,
      message: erro && erro.message ? erro.message : String(erro),
      incompativel: Boolean(erro && erro.incompativel),
    });
  }
};
