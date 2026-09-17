/**
 * Gerador de arquivos .zip sem dependencias externas.
 *
 * Os videos ja saem comprimidos do ffmpeg, entao o zip usa o metodo "store"
 * (sem compressao extra): ele serve apenas para juntar tudo em um download so.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/** Evita nomes repetidos dentro do zip. */
function uniqueNames(names) {
  const usados = new Map();
  return names.map((name) => {
    const count = usados.get(name) || 0;
    usados.set(name, count + 1);
    if (!count) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

/**
 * @param {{name: string, blob: Blob}[]} entries
 * @param {(feito: number, total: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function criarZip(entries, onProgress) {
  const encoder = new TextEncoder();
  const nomes = uniqueNames(entries.map((entry) => entry.name));
  const partes = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime(new Date());

  for (let i = 0; i < entries.length; i += 1) {
    const nome = encoder.encode(nomes[i]);
    const bytes = new Uint8Array(await entries[i].blob.arrayBuffer());
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versao necessaria
    local.setUint16(6, 0x0800, true); // nome do arquivo em UTF-8
    local.setUint16(8, 0, true); // metodo: store
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);

    partes.push(new Uint8Array(local.buffer), nome, bytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nome.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nome);

    offset += 30 + nome.length + bytes.length;
    if (onProgress) onProgress(i + 1, entries.length);
  }

  const tamanhoCentral = central.reduce((soma, parte) => soma + parte.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entries.length, true);
  fim.setUint16(10, entries.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, offset, true);

  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: "application/zip" });
}

/** O formato zip classico nao suporta mais de 4 GB. */
export const LIMITE_ZIP = 4 * 1024 * 1024 * 1024 - 64 * 1024 * 1024;
