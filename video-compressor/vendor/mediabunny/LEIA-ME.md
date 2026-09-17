# mediabunny

Cópia de [`mediabunny`](https://mediabunny.dev) 1.57.0 (licença MPL-2.0),
biblioteca que lê e escreve arquivos de mídia usando a **WebCodecs** — a API
que dá acesso ao codificador de vídeo do próprio computador (placa de vídeo ou
chip do processador).

É o motor do "modo rápido": em vez de comprimir por software (ffmpeg.wasm), o
navegador usa o hardware, o que é várias vezes mais rápido.

Fica aqui, e não num CDN, pelo mesmo motivo do núcleo do ffmpeg: com a página
isolada (modo turbo) o navegador barra arquivos de outros domínios, e assim o
app funciona também em rede fechada.

Para atualizar: `npm install mediabunny` e copie
`node_modules/mediabunny/dist/bundles/mediabunny.min.mjs`.
