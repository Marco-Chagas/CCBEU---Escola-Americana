# Núcleo multi-thread do ffmpeg.wasm

Cópia de `@ffmpeg/core-mt@0.12.10` (licença GPL/LGPL, projeto
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)).

Ele fica aqui, e não num CDN, por um motivo técnico: o modo turbo só funciona
com a página "isolada" (`COOP`/`COEP`), e nesse estado o navegador é muito mais
rigoroso com arquivos vindos de outros sites. Servindo o núcleo do mesmo
endereço do app, o turbo funciona em qualquer hospedagem — inclusive em rede
fechada, sem acesso ao CDN.

Para atualizar: `npm install` e copie de novo os três arquivos de
`node_modules/@ffmpeg/core-mt/dist/umd/`.
