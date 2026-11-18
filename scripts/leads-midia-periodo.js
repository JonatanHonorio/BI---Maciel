#!/usr/bin/env node
/**
 * MÍDIA DE ENTRADA DOS LEADS num período — de onde eles vieram.
 *
 * A mídia é `leads.origem_fonte`, NÃO `leads.origem`. O campo `origem` tem
 * "Lais" em 19.558 leads do período, e **Lais não é origem** — ela é quem
 * atendeu. Ver [[kurole_lais_nao_e_origem]].
 *
 * Três limpezas, todas necessárias para o mesmo canal não aparecer em quatro
 * linhas diferentes:
 *
 *  1. SUFIXO "Lais": "GrupoZapLais" é GrupoZap atendido pela Lais. Some o
 *     sufixo e sobra a origem. O script conta à parte quantos ela atendeu.
 *  2. PREFIXO "Lead - ": "Lead - ImovelWEB" e "ImovelWEB" são a mesma coisa.
 *  3. ENCODING QUEBRADO: "Fachada da Imobili?ria" (204) e "Fachada da
 *     Imobiliária" (111) são o mesmo canal; idem "J? ? Cliente"/"Já é
 *     Cliente" e "Indica??o"/"Indicação". É a armadilha da coluna congelada:
 *     `origem_fonte` não está no DO UPDATE SET de `ordem_atendimento`, então
 *     as linhas antigas ficaram com o texto da primeira importação, de antes
 *     do conserto de encoding. Ver [[import_coluna_congelada]].
 *
 * NÃO agrupo portais do mesmo dono. Canal Pro, GrupoZap, ZAP, VivaReal e OLX
 * são todos do Grupo OLX/ZAP, mas são entradas diferentes no cadastro e
 * juntá-las seria decisão de negócio, não de script.
 *
 * Uso: node scripts/leads-midia-periodo.js AAAA-MM-DD AAAA-MM-DD  (fim inclusivo)
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const [, , DE, ATE] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DE || "") || !/^\d{4}-\d{2}-\d{2}$/.test(ATE || "")) {
  console.error("uso: node scripts/leads-midia-periodo.js AAAA-MM-DD AAAA-MM-DD");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};

const SUFIXO_LAIS = /lais$/i;
/** Variantes com encoding quebrado -> o nome certo. Comparação sem acento. */
const CONSERTA = [
  [/^fachada da imobili.{1,3}ria$/i, "Fachada da Imobiliária"],
  [/^j.{1,3} .{1,3} cliente$/i, "Já é Cliente"],
  [/^indica.{1,3}.{0,3}o$/i, "Indicação"],
];
const NOMES = {
  grupozap: "GrupoZap", whatsapp: "WhatsApp", imovelweb: "ImovelWeb",
  facebookads: "Facebook Ads", instagramads: "Instagram Ads", googleads: "Google Ads",
  wimoveis: "WImóveis", propwebsite: "Site", site: "Site", placa: "Placa",
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok",
  zap: "GrupoZap", vivareal: "VivaReal", olx: "OLX",
};

function midia(v) {
  let t = String(v || "").trim();
  if (!t) return "(não informado)";
  // 1. sufixo Lais
  const semLais = t.replace(SUFIXO_LAIS, "").trim();
  const atendidaLais = semLais && semLais.toLowerCase() !== t.toLowerCase();
  if (atendidaLais) t = semLais;
  // 2. prefixo "Lead - "
  t = t.replace(/^lead\s*-\s*/i, "").trim();
  // 3. encoding
  for (const [re, bom] of CONSERTA) if (re.test(t)) return bom;
  const chave = t.toLowerCase().replace(/[^a-z]/g, "");
  return NOMES[chave] || t;
}
const ehLais = (v) => SUFIXO_LAIS.test(String(v || "").trim());
const num = (n) => Number(n).toLocaleString("pt-BR");

(async () => {
  const { rows } = await q(`
    SELECT l.origem_fonte, l.origem, l.locacao_venda,
      (SELECT u.departamento_id FROM lead_responsaveis r JOIN corretores u ON u.id = r.corretor_id
        WHERE r.lead_id = l.id ORDER BY r.data ASC NULLS LAST, r.id ASC LIMIT 1) AS dep
    FROM leads l
    WHERE l.data_inicio >= $1::date AND l.data_inicio < ($2::date + 1)`, [DE, ATE]);

  const MAPA = require("../src/lib/departamentos.json").departamentos;
  const vertical = (dep) => {
    const n = MAPA[String(dep)];
    const m = n && n.match(/^(?:Gerente\s+)?(Loca[cç][aã]o|Vendas?)\s/i);
    return m ? (/^loca/i.test(m[1]) ? "LOCAÇÃO" : "VENDAS") : null;
  };

  const tot = new Map();
  let comLais = 0;
  for (const x of rows) {
    const m = midia(x.origem_fonte);
    if (!tot.has(m)) tot.set(m, { m, n: 0, v: 0, l: 0, lais: 0 });
    const a = tot.get(m);
    a.n++;
    const vert = vertical(x.dep);
    if (vert === "VENDAS") a.v++; else if (vert === "LOCAÇÃO") a.l++;
    if (ehLais(x.origem_fonte)) { a.lais++; comLais++; }
  }

  const lista = [...tot.values()].sort((a, b) => b.n - a.n);
  const total = rows.length;
  console.log(`MÍDIA DE ENTRADA — ${DE.split("-").reverse().join("/")} a ${ATE.split("-").reverse().join("/")}`);
  console.log(`${num(total)} leads · ${num(comLais)} (${(100 * comLais / total).toFixed(1)}%) foram atendidos pela Lais\n`);
  console.log(`  ${"MÍDIA".padEnd(26)}${"LEADS".padStart(8)}${"%".padStart(7)}${"VENDAS".padStart(9)}${"LOCAÇÃO".padStart(10)}${"via Lais".padStart(10)}`);
  console.log("  " + "-".repeat(68));
  for (const x of lista) {
    console.log(`  ${x.m.slice(0, 25).padEnd(26)}${num(x.n).padStart(8)}${(100 * x.n / total).toFixed(1).padStart(7)}` +
      `${num(x.v).padStart(9)}${num(x.l).padStart(10)}${(x.lais ? num(x.lais) : "-").padStart(10)}`);
  }
  console.log("  " + "-".repeat(68));
  console.log(`  ${"TOTAL".padEnd(26)}${num(total).padStart(8)}`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
