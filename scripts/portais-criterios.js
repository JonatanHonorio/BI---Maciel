#!/usr/bin/env node
/**
 * CRITÉRIOS DE RANQUEAMENTO DOS PORTAIS DO GRUPO OLX (Canal Pro).
 *
 * Regra passada pelo diretor do Grupo OLX ao Jonatan em 19/11/2026, fora o
 * investimento em mídia:
 *   · boas fotos  (qualidade — NÃO é medível aqui, ver abaixo)
 *   · no mínimo  5 fotos para CASA
 *   · no mínimo 10 fotos para TERRENO
 *   · atualização nos últimos 30 dias
 *
 * ⚠️ "BOAS FOTOS" NÃO TEM COMO SER MEDIDO pela base. O único proxy existente é
 * `fotos.tamanho` (peso do arquivo): foto de portal abaixo de ~50 KB costuma
 * ser imagem pequena ou recomprimida. O script mostra isso como ALERTA, nunca
 * como reprovação — quem reprova foto é gente olhando.
 *
 * A contagem de fotos NÃO está no Neon: o import do KSI não traz a tabela
 * `fotos`. Rodar antes:
 *   node scripts/fotos-do-dump.js <dump.sql.gz> fotos-por-imovel.json
 * e passar o JSON aqui em --fotos. O dump usado pode ser mais antigo que o
 * banco; o script avisa a data de cada fonte para a diferença ficar explícita.
 *
 * Tipos sem regra declarada (apartamento, comercial) entram com o piso de
 * CASA (5) e saem marcados, para não inventarmos exigência que o portal não
 * fez.
 *
 * Uso:
 *   node scripts/portais-criterios.js --fotos fotos-por-imovel.json \
 *        --bairro urbanova --cidade "sao jose dos campos" [--listar]
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const { Pool } = require("pg");

const arg = (n, p = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : p;
};
const ARQ_FOTOS = arg("fotos");
const BAIRRO = arg("bairro");
const CIDADE = arg("cidade", "sao jose dos campos");
const DIAS = Number(arg("dias", 30));
const LISTAR = process.argv.includes("--listar");
const EXATO = process.argv.includes("--exato");
const LOCACAO = process.argv.includes("--locacao");
if (!ARQ_FOTOS || !fs.existsSync(ARQ_FOTOS)) {
  console.error("faltou --fotos <json gerado por scripts/fotos-do-dump.js>");
  process.exit(1);
}
const FOTOS = JSON.parse(fs.readFileSync(ARQ_FOTOS, "utf-8"));
/*
 * A data que importa é a do DUMP de onde as fotos saíram, não a do arquivo
 * JSON — o JSON pode ter sido gerado hoje a partir de um dump de semanas
 * atrás, e foi exatamente o que aconteceu em 19/11/2026.
 */
const DATA_FOTOS = FOTOS._dump
  ? `${new Date(FOTOS._dump.data).toLocaleDateString("pt-BR")} (${FOTOS._dump.arquivo.slice(0, 20)}…)`
  : `${fs.statSync(ARQ_FOTOS).mtime.toLocaleDateString("pt-BR")} — ATENÇÃO: data do JSON, não do dump`;

/** Mínimo de fotos por tipo. Só casa e terreno vieram do portal. */
const MINIMO = { casa: 5, terreno: 10 };
const PADRAO = 5;
const minimoDe = (tipo) => MINIMO[String(tipo || "").toLowerCase()] ?? PADRAO;
const temRegraPropria = (tipo) => String(tipo || "").toLowerCase() in MINIMO;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};
const sa = (c) => `translate(lower(${c}),'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ','aaaaeeioooucAAAAEEIOOOUC')`;
const pct = (n, t) => t ? `${(100 * n / t).toFixed(0)}%` : "-";

(async () => {
  const cond = [`i.removido_em IS NULL`];
  const par = [];
  cond.push(LOCACAO
    ? `i.locacao_venda LIKE '%L%' AND i.situacao_codigo_locacao = 1`
    : `i.locacao_venda LIKE '%V%' AND i.situacao_codigo_venda = 1`);
  if (CIDADE) { par.push(`%${CIDADE.toLowerCase()}%`); cond.push(`${sa("i.cidade")} LIKE $${par.length}`); }
  /*
   * --exato compara o bairro INTEIRO, sem acento e sem caixa. É o que separa
   * "Urbanova" (o bairro) de "Urbanova VII", "Loteamento Urbanova II" e
   * "Vivant Urbanova", que no Kurole são cadastros à parte. Sem isso o LIKE
   * '%urbanova%' junta os 445 da região; com isso ficam só os do bairro.
   */
  if (BAIRRO) {
    if (EXATO) { par.push(BAIRRO.toLowerCase()); cond.push(`TRIM(${sa("i.bairro")}) = $${par.length}`); }
    else { par.push(`%${BAIRRO.toLowerCase()}%`); cond.push(`${sa("i.bairro")} LIKE $${par.length}`); }
  }

  const { rows } = await q(`
    -- A REFERENCIA QUE O TIME USA E imoveis.id, nao imoveis.codigo, que vem
    -- zerado na quase totalidade da base. Confirmado contra a ref 38961 em
    -- 17/11/2026. (Sem crase neste comentario: ele vive dentro de um template
    -- literal, e uma crase aqui quebra o arquivo inteiro.)
    SELECT i.id, i.id AS codigo, i.bairro, i.tipo_mae, i.valor, i.data_atualizacao,
           EXTRACT(day FROM now() - i.data_atualizacao)::int dias
    FROM imoveis i WHERE ${cond.join(" AND ")} ORDER BY i.tipo_mae, i.id`, par);

  const { rows: [dump] } = await q(`SELECT max(data_atualizacao)::date d FROM imoveis`);

  const grupos = new Map();
  const reprovados = [];
  for (const r of rows) {
    const f = FOTOS[String(r.id)] || { n: 0, bytes: 0, menor: 0, maior: 0 };
    const min = minimoDe(r.tipo_mae);
    const okFoto = f.n >= min;
    const okData = r.dias !== null && r.dias <= DIAS;
    const mediaKB = f.n ? Math.round(f.bytes / f.n / 1024) : 0;
    const t = String(r.tipo_mae || "(sem tipo)");
    if (!grupos.has(t)) grupos.set(t, { t, min, proprio: temRegraPropria(r.tipo_mae), n: 0, foto: 0, data: 0, ambos: 0, semFoto: 0, leves: 0 });
    const g = grupos.get(t);
    g.n++;
    if (okFoto) g.foto++;
    if (okData) g.data++;
    if (okFoto && okData) g.ambos++;
    if (f.n === 0) g.semFoto++;
    if (f.n && mediaKB < 50) g.leves++;
    if (!okFoto || !okData) reprovados.push({ ...r, fotos: f.n, min, mediaKB, okFoto, okData });
  }

  const tot = rows.length;
  const som = (k) => [...grupos.values()].reduce((s, g) => s + g[k], 0);
  console.log(`CRITÉRIOS DO CANAL PRO — ${BAIRRO ? BAIRRO.toUpperCase() : "TODOS OS BAIRROS"}` +
    `${CIDADE ? `, ${CIDADE}` : ""} · ${LOCACAO ? "LOCAÇÃO" : "VENDA"}, disponíveis`);
  console.log(`fotos: dump de ${DATA_FOTOS} · cadastro: banco atualizado até ${dump.d.toLocaleDateString("pt-BR")}\n`);
  console.log(`  ${"TIPO".padEnd(14)}${"TOTAL".padStart(7)}${"mín".padStart(5)}${"c/ fotos".padStart(10)}${"atual.".padStart(9)}${"OS DOIS".padStart(10)}${"s/ foto".padStart(9)}${"<50KB".padStart(8)}`);
  console.log("  " + "-".repeat(72));
  for (const g of [...grupos.values()].sort((a, b) => b.n - a.n)) {
    console.log(`  ${(g.t + (g.proprio ? "" : " *")).padEnd(14)}${String(g.n).padStart(7)}${String(g.min).padStart(5)}` +
      `${(g.foto + " " + pct(g.foto, g.n)).padStart(10)}${(g.data + " " + pct(g.data, g.n)).padStart(9)}` +
      `${(g.ambos + " " + pct(g.ambos, g.n)).padStart(10)}${String(g.semFoto).padStart(9)}${String(g.leves).padStart(8)}`);
  }
  console.log("  " + "-".repeat(72));
  console.log(`  ${"TOTAL".padEnd(14)}${String(tot).padStart(7)}${"".padStart(5)}` +
    `${(som("foto") + " " + pct(som("foto"), tot)).padStart(10)}${(som("data") + " " + pct(som("data"), tot)).padStart(9)}` +
    `${(som("ambos") + " " + pct(som("ambos"), tot)).padStart(10)}${String(som("semFoto")).padStart(9)}${String(som("leves")).padStart(8)}`);
  console.log(`\n  * tipo sem mínimo declarado pelo portal — usei o piso de casa (${PADRAO}).`);
  console.log(`  "<50KB" = média de peso por foto; é ALERTA de qualidade, não reprovação.`);

  if (LISTAR) {
    console.log(`\nREPROVADOS (${reprovados.length}) — o que falta em cada um`);
    for (const r of reprovados.sort((a, b) => (a.fotos - a.min) - (b.fotos - b.min))) {
      const falta = [];
      if (!r.okFoto) falta.push(`faltam ${r.min - r.fotos} foto(s)`);
      if (!r.okData) falta.push(`parado há ${r.dias} dias`);
      console.log(`  ${String(r.codigo || r.id).padEnd(8)} ${String(r.tipo_mae || "").padEnd(12)} ${String(r.fotos).padStart(3)} fotos` +
        `${r.mediaKB ? ` (${String(r.mediaKB).padStart(3)} KB/foto)` : "            "}  ${String(r.bairro || "").slice(0, 22).padEnd(23)} ${falta.join(" · ")}`);
    }
  }
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
