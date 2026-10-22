#!/usr/bin/env node
// Extrai o <script> de index.html, troca os hooks de teste e o grava em /tmp.
// Uso: node test/extrair.js
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
const m = /<script>\n([\s\S]*)\n<\/script>/.exec(html);
if (!m) { console.error("script não encontrado em index.html"); process.exit(1); }

const js = m[1];
const alvo = "window.__assistente=";
if (!js.includes(alvo)) { console.error("hook window.__assistente não encontrado em index.html"); process.exit(1); }

const paraTeste = js.replace(alvo, "globalThis.__t=");
global.__assistenteCode = js;
global.__assistenteTesteCode = paraTeste;
module.exports = { js, paraTeste };
