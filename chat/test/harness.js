#!/usr/bin/env node
// Testes de regressão do chat (index.html), rodando o script do app em Node
// com um DOM mínimo. Não precisa de navegador nem de rede.
//
//   node test/harness.js
//
// Cobre: troca automática de modelo descomissionado, erro de base/chave,
// retry de temperature, erro 500, encurtamento por 413, "enviar sem histórico",
// timeout, backoff em 429 e "melhorar prompt".

const fs = require("fs");
const path = require("path");
const { paraTeste } = require("./extrair.js");

// ---------------- DOM mínimo ----------------
function el(id) {
  const e = {
    _id: id, value: "", textContent: "", className: "", disabled: false,
    style: new Proxy({}, { get: () => "", set: () => true }),
    dataset: {}, options: [], scrollTop: 0, scrollHeight: 0,
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    focus(){}, blur(){}, click(){}, appendChild(){}, removeChild(){},
    addEventListener(){}, removeEventListener(){},
    setAttribute(){}, getAttribute(){ return null; },
    querySelector(){ return el("x"); }, querySelectorAll(){ return []; },
    closest(){ return null; }, getBoundingClientRect(){ return {top:0,left:0,width:0,height:0}; },
  };
  Object.defineProperty(e, "innerHTML", {
    get(){ return this._ih || ""; },
    set(v){ this._ih = v; this.options = (String(v).match(/<option/g) || []).map(() => ({})); }
  });
  return e;
}
const cache = {};
function getEl(sel){ if (!cache[sel]) cache[sel] = el(sel); return cache[sel]; }

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const docEl = {
  _at: {},
  setAttribute(k, v){ this._at[k] = String(v); },
  getAttribute(k){ return (k in this._at) ? this._at[k] : null; },
  removeAttribute(k){ delete this._at[k]; },
};
global.document = {
  querySelector: getEl, querySelectorAll: () => [],
  createElement: () => el("created"), createTextNode: () => ({}),
  body: el("body"), addEventListener(){}, activeElement: null,
  documentElement: docEl,
};
global.window = global;
global.navigator = { clipboard: { writeText: async () => {} }, userAgent: "node" };
global.location = { href: "http://localhost:3000/", origin: "http://localhost:3000", protocol: "http:" };
global.prompt = () => "novo titulo";
global.AbortController = AbortController;
global.marked = { setOptions(){}, parse: s => "<p>" + s + "</p>" };
global.DOMPurify = { sanitize: s => s };
global.hljs = { highlightElement(){} };
global.URL = URL;
global.Image = function(){ return { set src(v){ setTimeout(() => this.onerror && this.onerror(), 0); } }; };
global.FileReader = function(){ return { readAsText(){}, set onload(f){}, set onerror(f){} }; };
global.confirm = () => true;
global.alert = () => {};

// IndexedDB falso para os testes extras: IDB=1 node test/harness.js
function fakeIndexedDB(){
  const dados = {};
  const clonar = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  function transacao(){
    const h = {};
    const store = {
      get(k){ const r = {}; setTimeout(() => { r.result = clonar(dados[k]); }, 0); return r; },
      put(v, k){ dados[k] = clonar(v); return { result: k }; },
    };
    return {
      objectStore(){ return store; },
      set oncomplete(f){ h.c = f; setTimeout(() => { if (f) f(); }, 5); },
      onerror: null, onabort: null,
    };
  }
  return {
    open(){
      const req = {};
      setTimeout(() => {
        req.result = { createObjectStore(){}, transaction(){ return transacao(); } };
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}
if (process.env.IDB) global.indexedDB = fakeIndexedDB();

let fetchImpl = null;
global.fetch = (...a) => fetchImpl(...a);
global.__assistenteCode = null;

// ---------------- executa o código do app ----------------
(0, eval)(paraTeste);
const t = global.__t;

const lastToast = () => getEl("#toast").textContent;
const status = () => getEl("#status").textContent;

function okStream(text) {
  const sse = "data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n" + "data: [DONE]\n\n";
  const enc = new TextEncoder().encode(sse);
  let done = false;
  return { ok: true, status: 200,
    body: { getReader(){ return { async read(){ if (done) return { done: true }; done = true; return { done: false, value: enc }; } }; } },
    async text(){ return ""; }, async json(){ return {}; } };
}
function fail(code, body) {
  return { ok: false, status: code, async text(){ return body; }, async json(){ return JSON.parse(body); } };
}
function stallStream() {
  return { ok: true, status: 200,
    body: { getReader(){ return { read(){ return new Promise(() => {}); }, cancel(){ return Promise.resolve(); } }; } },
    async text(){ return ""; }, async json(){ return {}; } };
}

let falhas = 0;
async function run(name, fn) {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { falhas++; console.log("  FALHA " + name + " -> " + e.message); }
}
function assert(c, m){ if (!c) throw new Error(m); }

function prepararConv(nPares, model) {
  t.state.key = "gsk_test";
  t.state.prov = "groq";
  t.state.base = "https://api.groq.com/openai/v1";
  t.state.model = model || "openai/gpt-oss-120b";
  const c = t.state.convs[0];
  c.msgs.length = 0;
  for (let i = 0; i < nPares; i++) c.msgs.push({ role: "user", content: "p" + i }, { role: "assistant", content: "r" + i });
  t.state.convId = c.id;
  return c;
}

(async () => {
  console.log("Testes do chat (index.html)\n");

  // 1) modelo descomissionado -> troca e reenvia
  {
    const c = prepararConv(0, "meta-llama/llama-3.3-70b-versatile");
    getEl("#chatInput").value = "oi";
    let calls = [];
    fetchImpl = async (url, opts) => {
      calls.push(url);
      if (url.endsWith("/models")) return { ok: true, status: 200, async json(){ return { data: [{ id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }] }; } };
      const body = JSON.parse(opts.body);
      if (body.model === "meta-llama/llama-3.3-70b-versatile")
        return fail(404, JSON.stringify({ error: { message: "Model has been decommissioned", code: "model_decommissioned" } }));
      assert(body.model === "openai/gpt-oss-120b", "esperava reenvio com gpt-oss-120b");
      return okStream("olá!");
    };
    await run("modelo descomissionado -> troca e reenvia automaticamente", async () => {
      await t.send();
      assert(t.state.model === "openai/gpt-oss-120b", "state.model não trocou");
      const msgs = c.msgs;
      assert(msgs[msgs.length-1].content === "olá!", "resposta não chegou");
      assert(calls.filter(u => u.endsWith("/chat/completions")).length === 2, "esperava 2 chamadas");
    });
  }

  // 2) base URL errada -> erro claro, sem loop
  {
    prepararConv(0);
    t.state.base = "https://api.groq.com/openai";
    getEl("#chatInput").value = "oi";
    let calls = [];
    fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith("/models")) return fail(404, JSON.stringify({ error: { message: "Unknown request URL: GET /openai/models" } }));
      return fail(404, JSON.stringify({ error: { message: "Unknown request URL: POST /openai/chat/completions" } }));
    };
    await run("base URL errada -> erro claro de base/chave, sem reenvio infinito", async () => {
      await t.send();
      assert(/falha ao listar modelos/.test(lastToast()), "toast: " + lastToast());
      assert(calls.filter(u => u.endsWith("/chat/completions")).length === 1, "não deveria reenviar");
    });
  }

  // 3) temperature rejeitada -> reenvia sem
  {
    prepararConv(0);
    getEl("#chatInput").value = "oi";
    let calls = [];
    fetchImpl = async (url, opts) => {
      calls.push(url);
      const body = JSON.parse(opts.body);
      if (body.temperature !== undefined) return fail(400, JSON.stringify({ error: { message: "temperature param is unsupported" } }));
      return okStream("ok sem temp");
    };
    await run("erro de temperature -> reenvia sem temperature", async () => {
      await t.send();
      const msgs = t.state.convs[0].msgs;
      assert(msgs[msgs.length-1].content === "ok sem temp", "resposta não veio");
      assert(calls.filter(u => u.endsWith("/chat/completions")).length === 2, "esperava 2 chamadas");
    });
  }

  // 4) 500 -> mostra HTTP 500, não chama /models
  {
    prepararConv(0);
    getEl("#chatInput").value = "oi";
    let calls = [];
    fetchImpl = async (url) => { calls.push(url); return fail(500, "erro interno"); };
    await run("erro 500 -> mostra HTTP 500 e não chama /models", async () => {
      await t.send();
      assert(/HTTP 500/.test(lastToast()), "toast: " + lastToast());
      assert(calls.filter(u => u.endsWith("/models")).length === 0, "não deveria chamar /models");
    });
  }

  // 5) modelo rejeitado mesmo na lista -> mensagem instrutiva
  {
    prepararConv(0);
    getEl("#chatInput").value = "oi";
    let calls = [];
    fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith("/models")) return { ok: true, status: 200, async json(){ return { data: [{ id: "openai/gpt-oss-120b" }] }; } };
      return fail(404, JSON.stringify({ error: { message: "model not found" } }));
    };
    await run("lista recarregada mas modelo continua inválido -> mensagem instrutiva", async () => {
      await t.send();
      assert(/Carregar modelos/.test(lastToast()), "toast: " + lastToast());
      assert(calls.filter(u => u.endsWith("/chat/completions")).length === 1, "não deveria reenviar indefinidamente");
    });
  }

  // 6) 413 -> encurta histórico
  {
    prepararConv(5);
    getEl("#chatInput").value = "pergunta final";
    const sizes = [];
    fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      sizes.push(body.messages.length);
      if (body.messages.length > 3)
        return fail(413, JSON.stringify({ error: { message: "Request too large ... (TPM): Limit 8000, Requested 11240, please reduce", type: "tokens", code: "rate_limit_exceeded" } }));
      return okStream("resposta enxuta");
    };
    await run("413 -> encurta histórico e reenvia automaticamente", async () => {
      await t.send();
      assert(sizes.length > 0, "fetch nunca chamado; toast=" + lastToast());
      assert(sizes[0] === 12, "1a tentativa deveria mandar 12 msgs, mandou " + sizes[0]);
      const msgs = t.state.convs[0].msgs;
      assert(msgs[msgs.length-1].content === "resposta enxuta", "resposta não chegou");
      assert(sizes[sizes.length-1] < sizes[0], "histórico não encolheu: " + JSON.stringify(sizes));
    });
  }

  // 7) "s/ hist." envia só a última
  {
    prepararConv(4);
    getEl("#chatInput").value = "sozinha";
    const sizes = [];
    fetchImpl = async (url, opts) => { sizes.push(JSON.parse(opts.body).messages.length); return okStream("respondido"); };
    await run('reenviarSemHist -> envia só sistema + 1 mensagem', async () => {
      t.reenviarSemHist();
      await new Promise(r => setTimeout(r, 30));
      assert(sizes.length && sizes[0] === 2, "esperava 2 mensagens, veio " + JSON.stringify(sizes));
      const msgs = t.state.convs[0].msgs;
      assert(msgs[msgs.length-1].content === "respondido", "resposta não veio");
    });
  }

  // 8) timeout
  {
    t.setTimeoutMs(80);
    prepararConv(0);
    getEl("#chatInput").value = "demora";
    fetchImpl = (url, opts) => new Promise((_, rej) => {
      if (opts && opts.signal) opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }, { once: true });
    });
    await run("timeout -> mensagem de tempo esgotado", async () => {
      await t.send();
      assert(/tempo esgotado/.test(lastToast()), "toast: " + lastToast());
    });
    t.setTimeoutMs(120000);
  }

  // 9) 429 -> backoff e retry
  {
    prepararConv(0);
    getEl("#chatInput").value = "de novo";
    let n = 0;
    fetchImpl = async () => {
      n++;
      if (n === 1) return fail(429, JSON.stringify({ error: { message: "Rate limit reached ... try again in 0.01 s.", code: "rate_limit_exceeded" } }));
      return okStream("depois do 429");
    };
    await run("429 -> backoff e reenvia com sucesso", async () => {
      await t.send();
      const msgs = t.state.convs[0].msgs;
      assert(msgs[msgs.length-1].content === "depois do 429", "resposta não veio");
      assert(n === 2, "esperava 2 chamadas, houve " + n);
    });
  }

  // 10) improve()
  {
    prepararConv(0, "modelo-velho");
    getEl("#imgPrompt").value = "gato";
    fetchImpl = async (url, opts) => {
      if (url.endsWith("/models")) return { ok: true, status: 200, async json(){ return { data: [{ id: "openai/gpt-oss-120b" }] }; } };
      const body = JSON.parse(opts.body);
      if (body.model === "modelo-velho") return fail(404, JSON.stringify({ error: { message: "model has been decommissioned", code: "model_decommissioned" } }));
      return { ok: true, status: 200, async json(){ return { choices: [{ message: { content: "prompt melhorado" } }] }; } };
    };
    await run("improve() -> trata modelo descomissionado e retorna texto", async () => {
      await t.improve("#imgPrompt");
      assert(getEl("#imgPrompt").value === "prompt melhorado", "valor: " + getEl("#imgPrompt").value);
      assert(t.state.model === "openai/gpt-oss-120b", "modelo não trocou");
    });
  }

  // 11) busca de conversas
  {
    prepararConv(0);
    // cria conversas com títulos distintos
    t.state.convs.length = 0;
    const mk = (titulo, texto) => {
      const c = { id: "c" + titulo, title: titulo, msgs: [{ role: "user", content: texto }], t: Date.now() };
      t.state.convs.push(c); return c;
    };
    mk("receita de bolo", "como fazer bolo");
    mk("codigo python", "def foo(): pass");
    mk("outra coisa", "nada aqui");
    getEl("#convBusca").value = "";
    await run("conversasFiltradas -> sem busca retorna todas", async () => {
      assert(t.conversasFiltradas().length === 3, "esperava 3, veio " + t.conversasFiltradas().length);
    });
    await run("conversasFiltradas -> busca por título", async () => {
      getEl("#convBusca").value = "python";
      const r = t.conversasFiltradas();
      assert(r.length === 1 && r[0].title === "codigo python", "filtro por título falhou");
    });
    await run("conversasFiltradas -> busca por conteúdo", async () => {
      getEl("#convBusca").value = "fazer bolo";
      const r = t.conversasFiltradas();
      assert(r.length === 1 && r[0].title === "receita de bolo", "filtro por conteúdo falhou");
    });
    getEl("#convBusca").value = "";
    t.state.convId = t.state.convs[0].id;
    t.renderConvSel();
  }

  // 12) renomear conversa
  {
    prepararConv(0);
    t.state.convs[0].title = "antigo";
    t.state.convId = t.state.convs[0].id;
    await run("renomearConversa -> usa prompt e atualiza título", async () => {
      t.renomearConversa();
      assert(t.state.convs[0].title === "novo titulo", "título: " + t.state.convs[0].title);
    });
  }

  // 13) editar mensagem do meio -> corta dali pra frente
  {
    const c = prepararConv(2); // [user p0, assistant r0, user p1, assistant r1]
    const antes = c.msgs.length;
    await run("editarMensagem -> corta a partir do índice e carrega no input", async () => {
      t.editarMensagem(2); // mensagem "user p1"
      assert(c.msgs.length === 2, "esperava 2 mensagens restantes, veio " + c.msgs.length);
      assert(getEl("#chatInput").value === "p1", "input: " + getEl("#chatInput").value);
      assert(antes === 4, "setup errado");
    });
  }

  // 14) botão Enviar deve mandar o histórico (onclick recebe o MouseEvent)
  {
    prepararConv(3); // 6 mensagens antigas
    getEl("#chatInput").value = "pergunta";
    const tamanhos = [];
    fetchImpl = async (url, opts) => { tamanhos.push(JSON.parse(opts.body).messages.length); return okStream("ok"); };
    await run("botão Enviar -> inclui o histórico (clique não conta como 'sem histórico')", async () => {
      await getEl("#sendBtn").onclick({ type: "click" });
      // sistema + 6 antigas + 1 nova
      assert(tamanhos.length && tamanhos[0] === 8, "esperava 8 mensagens, veio " + JSON.stringify(tamanhos));
    });
  }

  // 15) busca não deve trocar a conversa exibida
  {
    t.state.convs.length = 0;
    const a = { id: "cA", title: "alpha", msgs: [{ role: "user", content: "alfa" }], t: 1 };
    const b = { id: "cB", title: "beta",  msgs: [{ role: "user", content: "beta" }], t: 2 };
    t.state.convs.push(a, b);
    t.state.convId = a.id;
    getEl("#convBusca").value = "beta";
    await run("busca -> não troca a conversa atual nem desalinha o painel", async () => {
      t.renderConvSel();
      assert(t.state.convId === a.id, "convId mudou para " + t.state.convId);
      assert(getEl("#convSel").innerHTML.includes("alpha"), "conversa atual sumiu do seletor");
    });
    getEl("#convBusca").value = "";
  }

  // 16) erro não deixa resposta vazia no histórico
  {
    const c = prepararConv(0);
    getEl("#chatInput").value = "oi";
    fetchImpl = async () => fail(500, "erro interno");
    await run("erro 500 -> não deixa mensagem de assistente vazia", async () => {
      await t.send();
      assert(!c.msgs.some(m => m.role === "assistant" && !m.content), "sobrou resposta vazia");
    });
  }

  // 17) "Carregar modelos" usa a Base URL do formulário
  {
    prepararConv(0);
    t.state.base = "https://antiga/v1";
    getEl("#cfgBase").value = "https://nova/v1";
    getEl("#cfgKey").value = "k";
    const urls = [];
    fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, async json(){ return { data: [{ id: "m" }] }; } }; };
    await run("Carregar modelos -> usa a Base URL do formulário", async () => {
      await t.loadModels();
      assert(urls[0] === "https://nova/v1/models", "buscou em " + urls[0]);
    });
  }

  // 18) stream que trava no meio -> timeout por chunk
  {
    t.setTimeoutMs(60);
    const c = prepararConv(0);
    getEl("#chatInput").value = "trava";
    fetchImpl = async () => stallStream();
    await run("stream parado no meio -> tempo esgotado (não trava para sempre)", async () => {
      await t.send();
      assert(/tempo esgotado/.test(lastToast()), "toast: " + lastToast());
      assert(!c.msgs.some(m => m.role === "assistant" && !m.content), "sobrou resposta vazia");
    });
    t.setTimeoutMs(120000);
  }

  // 19) apagar chave remove também a chave legada
  {
    localStorage.setItem("st_groq_key", "gsk_velha");
    t.state.key = "gsk_velha";
    await run("apagar chave -> remove a chave legada st_groq_key", async () => {
      getEl("#cfgClearKey").onclick();
      assert(localStorage.getItem("st_groq_key") === null, "chave legada continuou");
      assert(t.state.key === "", "state.key não limpou");
    });
  }

  // 20) renderImg escapa a URL da imagem
  {
    t.state.img = [{ p: "x", w: 1, h: 1, m: "flux", u: '"><img src=x onerror=alert(1)>' }];
    await run("renderImg -> escapa a URL da imagem", async () => {
      t.renderImg();
      const ih = getEl("#imgGrid").innerHTML;
      assert(ih.includes("&lt;img src=x"), "não escapou: " + ih);
      assert(!ih.includes("<img src=x"), "HTML cru injetado: " + ih);
    });
    t.state.img = [];
  }

  // 21) paraApi converte anexos para o formato da API
  {
    await run("paraApi -> texto do anexo no conteúdo e imagem como image_url", async () => {
      const api = t.paraApi([{ role: "user", content: "veja", attachments: [
        { nome: "nota.txt", tipo: "texto", conteudo: "linha secreta" },
        { nome: "foto.jpg", tipo: "imagem", conteudo: "data:image/jpeg;base64,AAA" }
      ]}]);
      assert(Array.isArray(api[0].content), "deveria ser multimodal");
      assert(api[0].content[0].type === "text" && /linha secreta/.test(api[0].content[0].text), "texto do anexo ausente");
      assert(api[0].content[1].type === "image_url" && /^data:image\//.test(api[0].content[1].image_url.url), "imagem não convertida");
    });
  }

  // 22) exportação em Markdown
  {
    await run("conversaMd -> título, papéis e anexo", async () => {
      const md = t.conversaMd({ title: "Teste", t: 0, msgs: [
        { role: "user", content: "oi", attachments: [{ nome: "a.txt", tipo: "texto", conteudo: "CONTEUDO" }] },
        { role: "assistant", content: "olá" }
      ]});
      assert(/^# Teste/m.test(md), "sem título");
      assert(/## você/.test(md) && /## assistente/.test(md), "sem papéis");
      assert(/CONTEUDO/.test(md), "anexo ausente no markdown");
    });
  }

  // 23) envio com anexo de texto
  {
    const c = prepararConv(0);
    getEl("#chatInput").value = "resuma";
    t.state.anexos = [{ nome: "n.txt", tipo: "texto", conteudo: "segredo123", tamanho: 10 }];
    let enviado = null;
    fetchImpl = async (url, opts) => {
      if (!url.endsWith("/chat/completions")) return fail(404, "x");
      enviado = JSON.parse(opts.body);
      return okStream("ok");
    };
    await run("send -> conteúdo do anexo vai junto e a mensagem guarda o anexo", async () => {
      await t.send();
      assert(enviado, "não enviou");
      const m = enviado.messages[enviado.messages.length - 1];
      assert(/segredo123/.test(m.content), "conteúdo do anexo não foi enviado");
      const u = c.msgs.find(x => x.role === "user");
      assert(u.attachments && u.attachments[0].nome === "n.txt", "anexo não foi guardado");
      assert(t.state.anexos.length === 0, "anexos pendentes não limparam");
    });
  }

  // 24) fallback entre provedores
  {
    const c = prepararConv(0);
    t.state.fb = { prov: "openrouter", base: "https://fb.example/v1", key: "k2", model: "m2" };
    getEl("#chatInput").value = "oi";
    const urls = [];
    fetchImpl = async (url) => {
      urls.push(url);
      if (url.startsWith("https://fb.example")) return okStream("veio do reserva");
      return fail(500, "caiu");
    };
    await run("fallback -> usa o provedor reserva quando o principal dá 500", async () => {
      await t.send();
      assert(urls.some(u => u.startsWith("https://fb.example")), "não chamou o reserva: " + urls.join(", "));
      const msgs = c.msgs;
      assert(msgs[msgs.length - 1].content === "veio do reserva", "resposta do reserva não chegou");
    });
    t.state.fb = { prov: "", base: "", key: "", model: "" };
  }

  // 25) tema claro/escuro
  {
    await run("aplicaTema -> alterna data-theme e persiste", async () => {
      t.aplicaTema("light");
      assert(global.document.documentElement.getAttribute("data-theme") === "light", "não aplicou claro");
      assert(localStorage.getItem("st_theme") === "light", "não persistiu");
      t.aplicaTema("dark");
      assert(global.document.documentElement.getAttribute("data-theme") === null, "não voltou escuro");
    });
  }

  // ---- testes com IndexedDB (rodar com IDB=1) ----
  if (process.env.IDB) {
    // 26) save(): localStorage enxuto, IndexedDB completo
    {
      const c = prepararConv(0);
      c.msgs.length = 0;
      c.msgs.push({ role: "user", content: "oi", attachments: [{ nome: "a.txt", tipo: "texto", conteudo: "GRANDE", tamanho: 6 }] });
      c.msgs.push({ role: "assistant", content: "ok" });
      await run("IDB -> save() guarda versão enxuta no localStorage e completa no IndexedDB", async () => {
        t.save();
        const ls = JSON.parse(localStorage.getItem("st_convs"));
        const attLs = ls.find(x => x.id === c.id).msgs.find(m => m.attachments).attachments[0];
        assert(attLs.conteudo === undefined, "localStorage não foi enxugado");
        await new Promise(r => setTimeout(r, 380));
        const cheio = await t.IDB.get("convs");
        const attIdb = cheio.find(x => x.id === c.id).msgs.find(m => m.attachments).attachments[0];
        assert(attIdb.conteudo === "GRANDE", "IndexedDB não guardou o conteúdo");
      });
    }

    // 27) hidratarIDB restaura anexos após "recarregar"
    {
      const antes = t.state.convs.find(c => c.msgs.some(m => m.attachments && m.attachments.length));
      if (antes) antes.msgs.find(m => m.attachments).attachments[0].conteudo = "";
      t.state.convs = [];
      t.state.convId = "";
      await run("IDB -> hidratarIDB() restaura conversa e anexos", async () => {
        await t.hidratarIDB();
        const c = t.state.convs.find(x => x.msgs.some(m => m.attachments && m.attachments.length));
        assert(c, "conversa não voltou");
        assert(c.msgs.find(m => m.attachments).attachments[0].conteudo === "GRANDE", "anexo não restaurado");
      });
    }

    // 28) imagens: LS enxuto + restauração
    {
      t.state.img = [{ p: "gato", w: 1, h: 1, m: "flux", u: "data:image/jpeg;base64,ABC", t: 1 }];
      await run("IDB -> persistImg() e hidratarIDB() preservam as imagens", async () => {
        t.persistImg();
        const ls = JSON.parse(localStorage.getItem("st_img_history"));
        assert(ls[0].u === undefined, "localStorage guardou a imagem inteira");
        await new Promise(r => setTimeout(r, 380));
        t.state.img = [];
        await t.hidratarIDB();
        assert(t.state.img.length === 1 && /^data:image\//.test(t.state.img[0].u), "imagem não restaurada");
      });
    }
  }

  console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\nTODOS OS TESTES PASSARAM");
  process.exit(falhas ? 1 : 0);
})();
