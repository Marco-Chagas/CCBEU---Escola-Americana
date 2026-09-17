/**
 * Carrega o mesmo nucleo ffmpeg.wasm que o navegador usa, porem dentro do
 * Node, para que os testes exercitem exatamente o codigo de producao.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

export function resolveCoreDir() {
  try {
    // O pacote so expoe o ponto de entrada principal (dist/umd/ffmpeg-core.js).
    return path.dirname(require.resolve("@ffmpeg/core"));
  } catch {
    throw new Error(
      "O pacote @ffmpeg/core nao esta instalado. Rode 'npm install' dentro de video-compressor/ antes dos testes.",
    );
  }
}

export async function loadCore() {
  const dir = resolveCoreDir();
  // O nucleo e compilado para a web; damos os globais minimos que ele espera.
  globalThis.self = globalThis;
  globalThis.location = { href: "https://local/ffmpeg-core.js" };
  globalThis.document = { currentScript: { src: "https://local/ffmpeg-core.js" } };

  const createFFmpegCore = require(path.join(dir, "ffmpeg-core.js"));
  const core = await createFFmpegCore({
    wasmBinary: readFileSync(path.join(dir, "ffmpeg-core.wasm")),
    print() {},
    printErr() {},
  });

  const logs = [];
  core.setLogger((entry) => {
    if (entry && entry.message) logs.push(`${entry.type}|${entry.message}`);
  });

  return {
    core,
    logs,
    exec(...args) {
      logs.length = 0;
      const code = core.exec(...args);
      core.reset();
      return code;
    },
    probe(file) {
      logs.length = 0;
      core.ffprobe("-v", "error", "-print_format", "json", "-show_format", "-show_streams", file);
      core.reset();
      const stdout = logs
        .filter((line) => line.startsWith("stdout|"))
        .map((line) => line.slice("stdout|".length))
        .join("");
      return JSON.parse(stdout);
    },
    lastLogs() {
      return logs.join("\n");
    },
  };
}
