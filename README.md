# Assistente

Interface de chat local em um único arquivo (`chat/index.html`), compatível com qualquer
endpoint OpenAI Chat Completions (Groq, OpenRouter, OpenAI, DeepSeek, Together, LM Studio etc.),
com geração de imagens via Pollinations e prompts de vídeo.

## Recursos

- Chat com streaming suavizado, raciocínio (quando o modelo expõe), regenerar, editar e reenviar sem histórico.
- Anexos por botão, arrastar/soltar ou colar: imagens (redimensionadas) e arquivos de texto.
- Rascunho por conversa (texto e anexos) preservado ao trocar de conversa ou recarregar.
- Título automático gerado pelo modelo após a primeira resposta (pode ser desligado em Config).
- Histórico e galeria de imagens completos no IndexedDB; o `localStorage` guarda uma versão enxuta.
- Provedor reserva (fallback) para rede, timeout, 429 e 5xx, inclusive no meio do stream.
- Voz: ditado em pt-BR (`ditar`) e leitura das respostas (`ouvir`).
- Tema claro/escuro persistente.
- Exportar/copiar a conversa em Markdown; exportar/importar conversas em JSON.
- Resumo manual do histórico para reduzir o contexto enviado.
- PWA instalável e funcional offline: service worker com cache-first para `vendor/` e
  network-first com fallback para o app shell nas demais rotas.

## Requisitos

- Python 3 (apenas para servir arquivos estáticos).
- Chrome ou Edge para ditado/leitura por voz. O microfone exige `localhost` ou HTTPS.
- Chave de API do provedor de texto. Chave do Pollinations é opcional (imagens).

## Como rodar

Serviço de usuário (recomendado, porta 3000):

```bash
systemctl --user status assistente.service
systemctl --user restart assistente.service
journalctl --user -u assistente.service -n 50
```

Para iniciar no boot sem login, habilite o linger: `loginctl enable-linger "$USER"`.

Alternativa manual:

```bash
chat/start.sh      # sobe em http://localhost:3000
chat/stop.sh       # encerra
```

Abra <http://localhost:3000/> no navegador.

## Configuração

Na aba **Config**:

1. Escolha o provedor, confirme a **Base URL** e cole a **chave**.
2. Clique em **Carregar modelos**, escolha o modelo e **Salvar**.
3. Opcional: configure o **provedor reserva** (provedor, base, chave, carregar modelos).
4. Opcional: informe a chave do Pollinations para gerar imagens sem o limite grátis.
5. Opcional: desmarque **Título automático** para evitar a chamada extra que nomeia a conversa.

As chaves ficam somente no navegador (`localStorage`) e são enviadas apenas ao provedor
correspondente. Não use em máquina compartilhada.

Modelos de imagem: para enviar imagens no chat, o modelo precisa ser multimodal
(ex.: `llama-3.2-11b-vision` na Groq). Caso contrário a API responde erro 400.

## Atalhos

- `Enter` envia; `Shift+Enter` quebra linha.
- `Ctrl+K` nova conversa; `Ctrl+L` foca o campo de mensagem.
- `Esc` interrompe a geração ou limpa a busca de conversas.
- `↑` no campo vazio recupera a última mensagem enviada.

## Testes

Sem navegador nem rede (DOM mínimo em Node):

```bash
node chat/test/harness.js          # 35 testes
IDB=1 node chat/test/harness.js    # inclui 6 testes do IndexedDB (41)
```

## Estrutura

```
chat/index.html            aplicativo completo (HTML + CSS + JS)
chat/sw.js                 service worker (network-first)
chat/manifest.webmanifest  manifesto PWA
chat/icons/                ícones
chat/vendor/               marked, DOMPurify e highlight.js
chat/test/harness.js       testes de regressão
chat/test/extrair.js       extrai o script inline do index.html
chat/start.sh, stop.sh     execução manual
```

## Limitações

- O fallback só entra em falhas de rede/timeout/429/5xx; erros de configuração (401, 400) não.
- O resumo de histórico é manual e mantém as 4 últimas mensagens intactas.
- A leitura em voz usa a voz padrão do sistema (`speechSynthesis`); a qualidade varia por SO.
- O app depende do suporte do navegador a `fetch`, `IndexedDB` e `AbortController`.

## Manutenção

- O service worker é network-first para arquivos do próprio site; ao alterar `index.html`,
  basta recarregar. Se necessário, use DevTools → Application → Service Workers → Update.
- Logs manuais ficam em `chat/server-3000.log` (ignorado pelo git).
- Em Debian/Ubuntu, rode `sudo apt update` antes de instalar pacotes (as listas foram limpas
  para liberar espaço).
