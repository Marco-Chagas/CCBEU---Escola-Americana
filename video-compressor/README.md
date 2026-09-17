# 🎬 Compressor de Vídeo Online

App para comprimir vídeos de **qualquer formato** direto no navegador: você envia os
arquivos, escolhe o tipo de compressão e baixa o resultado. Nenhum vídeo é enviado
para servidores — todo o processamento acontece no seu próprio computador, usando
[ffmpeg.wasm](https://ffmpegwasm.netlify.app/).

## O que dá para fazer

- **Enviar vários vídeos de uma vez** (arrastar e soltar ou escolher no computador).
- **Escolher o tipo de compressão:**
  - **Por qualidade** — níveis *Leve*, *Equilibrado*, *Forte*, *Extrema* ou CRF manual.
  - **Por tamanho alvo** — "quero que caiba em 16 MB" e o app calcula o bitrate.
- **Escolher o formato de saída:** MP4/H.264 (padrão), WebM/VP8 e MP4/H.265 (HEVC,
  disponível quando o modo turbo está ligado).
- **Ajustar resolução** (até 4K, nunca aumenta a imagem), **quadros por segundo**,
  **qualidade do áudio** ou remover o áudio.
- **Ver o progresso** de cada arquivo com tempo restante estimado.
- **Baixar** cada vídeo individualmente ou **todos de uma vez em um `.zip`**.

### Formatos de entrada aceitos

MP4, MOV, AVI, MKV, WebM, WMV/ASF, FLV, MPEG/MPG, MPEG-TS, 3GP, OGV, DV, VOB, MXF,
ProRes, DNxHD e praticamente qualquer coisa que o FFmpeg leia — incluindo arquivos
que o próprio navegador não consegue reproduzir.

## Como usar

Abra a página publicada (veja *Publicação* abaixo) e:

1. **Envie os vídeos** no passo 1.
2. **Escolha o tipo de compressão** no passo 2.
3. Clique em **Comprimir tudo** e depois em **Baixar**.

Quando o vídeo é acelerado por hardware, não há nada para baixar. Se o arquivo
precisar do motor completo, aí sim ele baixa ~32 MB na primeira vez — depois
fica guardado no cache do navegador.

### Os dois motores

O app tem dois motores e escolhe sozinho, arquivo por arquivo:

| | **Hardware (WebCodecs)** | **Completo (ffmpeg.wasm)** |
| --- | --- | --- |
| Velocidade | usa o codificador de vídeo do próprio computador — muito mais rápido | software puro; o modo turbo ajuda, mas ainda é lento |
| Formatos de entrada | MP4, MOV, WebM, MKV | praticamente tudo (AVI, WMV, FLV, MPEG-TS, ProRes…) |
| Qualidade | por bitrate (o codificador do hardware não aceita CRF) | CRF exato |
| Quando roda | quando o navegador tem WebCodecs, sabe decodificar o vídeo e codificar o formato escolhido | em todos os outros casos |

A regra é simples: **tenta o hardware; se ele não aceitar o arquivo ou falhar no
meio, o mesmo vídeo vai para o motor completo automaticamente**, sem o usuário
precisar fazer nada. O cartão de cada vídeo mostra qual motor foi usado, e o
seletor *Motor de compressão* permite forçar o completo (útil quando se quer o
CRF exato).

Como o hardware trabalha por bitrate, os níveis de qualidade são convertidos
para bitrate em `buildHardwareJob()` (regra: cada 6 pontos de CRF dobram ou
reduzem o bitrate pela metade, ajustado pela eficiência do codec) — a mesma
conta que o x264 usa na prática. Por isso o tamanho final pode variar um pouco
entre os dois motores.

### Sobre os codecs

O motor é o build WebAssembly do FFmpeg, e nem todo codificador funciona nele.
O que está na interface foi testado no Chromium e no Node com o mesmo binário:

| Saída | Situação |
| --- | --- |
| **MP4 / H.264** | funciona sempre — é o padrão |
| **WebM / VP8** | funciona sempre |
| **MP4 / H.265 (HEVC)** | pelo hardware, sempre que o navegador souber codificá-lo; pelo ffmpeg, só com o **modo turbo** (sem multi-thread o x265 trava ao criar o *thread pool*, e o app troca por H.264 avisando) |
| ~~WebM / VP9~~ | fora da lista: estoura a memória do WebAssembly e derruba a aba |

Duas armadilhas encontradas nos testes e já contornadas no código: `-ac 2` junto
com o libopus quebra o ffmpeg.wasm, e um erro de memória do WebAssembly inutiliza
o motor — por isso o app o reinicia e tenta de novo automaticamente.

### Modo turbo

O ffmpeg multi-thread precisa que a página seja "isolada" (cabeçalhos
`COOP`/`COEP`). Como o GitHub Pages e a maioria das hospedagens estáticas não
deixam configurar cabeçalhos, o app registra um *service worker* que os
adiciona — e faz isso **sozinho na primeira visita**, recarregando a página uma
única vez. Depois disso a compressão usa todos os núcleos do processador (3 a 4
vezes mais rápida nos testes) e o H.265 fica disponível.

Se o navegador não aceitar, o app desiste em silêncio, avisa na tela e continua
funcionando no modo normal — o turbo é um acelerador, nunca uma dependência. O
mesmo vale se o motor falhar com ele ligado: o app desliga o turbo, tira o
service worker do caminho e recarrega no modo normal.

Por isso o núcleo multi-thread mora em `vendor/ffmpeg-core-mt/` em vez de vir do
CDN: com a página isolada, o navegador fica muito mais rigoroso com arquivos de
outros domínios, e servir do mesmo endereço faz o turbo funcionar em qualquer
hospedagem — inclusive em rede fechada.

### Limites

- Tudo roda na memória do navegador: arquivos acima de ~500 MB podem ficar lentos ou
  falhar por falta de memória (o limite técnico do WebAssembly é 2 GB por processo).
- O VP8 comprime menos que o H.264 no mesmo nível de qualidade; use-o quando
  precisar de WebM.
- No celular funciona, mas espere bem mais tempo e prefira vídeos curtos.

## Desenvolvimento

```console
cd video-compressor
npm install          # baixa o núcleo do ffmpeg usado nos testes
npm run dev          # http://localhost:8080
npm run dev -- --isolate   # liga COOP/COEP (modo turbo sem service worker)
```

Com o núcleo instalado localmente o servidor também o publica em `/vendor/core`,
o que permite usar o app **sem internet**:
`http://localhost:8080/?core=/vendor/core`.

### Testes

```console
npm test             # comprime vídeos de verdade (MP4, MOV, AVI, MKV, WebM) e confere o resultado
                     # 28 verificações, leva alguns minutos
npm i -D playwright  # opcional, para o teste de navegador
npm run test:browser # abre o app no Chromium, envia, comprime e baixa
```

O `npm test` gera vídeos de teste com o próprio ffmpeg, roda **os mesmos argumentos
que a interface monta** e valida cada saída com o `ffprobe`: codec, resolução,
duração, presença de áudio, ordem dos níveis de compressão, precisão do modo
"tamanho alvo" e a tradução das opções para o motor de hardware — 35 verificações.

O `npm run test:browser` exercita o app inteiro no Chromium, nos dois motores.
Uma limitação do ambiente de teste: o Chromium do Playwright não traz os codecs
proprietários (H.264, HEVC, AAC), então o motor de hardware é testado com
VP8/Opus. No Chrome ou no Edge do usuário, o mesmo código roda com H.264
acelerado por hardware.

## Publicação

O app está no ar em
**https://marco-chagas.github.io/CCBEU---Escola-Americana/video-compressor/**

A pasta é um site estático puro (sem build), publicado pelo GitHub Pages no modo
*Deploy from a branch* (`main`, pasta raiz). Ou seja: **todo push na `main`
republica o site sozinho**, sem workflow nenhum. O `index.html` da raiz do
repositório redireciona para cá, e o `.nojekyll` impede o Jekyll de mexer nos
arquivos.

Qualquer outra hospedagem de arquivos estáticos também serve (Netlify, Vercel,
S3, servidor interno): é só publicar o conteúdo de `video-compressor/`.

### Instalar como aplicativo

O `manifest.webmanifest` deixa o app instalável. No Chrome ou Edge, o menu
oferece *Instalar* / *Instalar este site como um aplicativo* — isso cria o atalho
na área de trabalho com o ícone próprio e abre o app em janela separada, sem
barra de navegação. Os ícones estão em `assets/icones/` (gerados a partir de
`icone.svg` e `icone-pequeno.svg`, esta segunda versão para 16–48 px) e o
`favicon.ico` reúne os cinco tamanhos que o Windows usa.

Para usar **sem depender do CDN** (rede fechada), copie
`node_modules/@ffmpeg/core/dist/umd` para dentro do site e abra com
`?core=/caminho/para/o/nucleo`. A versão multi-thread é procurada no mesmo
caminho com o sufixo `-mt` (`/caminho/para/o/nucleo-mt`).

## Como está organizado

| Arquivo | Função |
| --- | --- |
| `index.html` | estrutura da página |
| `assets/styles.css` | aparência (tema claro e escuro) |
| `assets/app.js` | interface, fila de arquivos, progresso e downloads |
| `assets/compression.js` | **regras de compressão** — transforma as opções em argumentos do ffmpeg e em opções do hardware |
| `assets/hardware-worker.js` | motor de hardware (WebCodecs, via mediabunny) |
| `assets/ffmpeg-worker.js` | carrega o ffmpeg.wasm e executa as conversões fora da thread principal |
| `assets/zip.js` | gera o `.zip` do "baixar tudo" |
| `coi-serviceworker.js` | cabeçalhos do modo turbo |
| `manifest.webmanifest` | permite instalar o app na área de trabalho |
| `assets/icones/` | ícones do app (SVG de origem e PNGs gerados) |
| `vendor/ffmpeg-core-mt/` | núcleo multi-thread do ffmpeg, servido pelo próprio site |
| `vendor/mediabunny/` | biblioteca que lê e escreve mídia usando WebCodecs |
| `scripts/` | servidor local e testes automatizados |

> O ffmpeg é distribuído sob licença GPL/LGPL. Este app apenas o carrega no
> navegador a partir do CDN público do jsDelivr.
