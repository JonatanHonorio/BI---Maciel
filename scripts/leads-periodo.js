#!/usr/bin/env node
/**
 * LEADS RECEBIDOS NUM PERÍODO — total, por operação e por unidade x operação.
 *
 * Usa a MESMA definição do fechamento (`scripts/leads-por-unidade.js`, a
 * métrica ENTRADA, oficial desde 05/11/2026): conta a ordem de atendimento
 * ABERTA no período, e a unidade/vertical é a do **primeiro responsável**.
 * Não é "tudo que a unidade pegou" — lead antigo repescado não entra, senão o
 * denominador deixa de ser comparável entre unidades e entre meses.
 *
 * ⚠️ A VERTICAL VEM DO DEPARTAMENTO do primeiro responsável ("Vendas
 * Aquarius", "Locação Dutra"), não de `leads.locacao_venda`. Os dois
 * discordam em parte dos leads, e o script mostra a diferença no fim — quem
 * manda é o departamento, que é o critério já formalizado à diretoria.
 *
 * Nomes ATUAIS das unidades (Satélite, Esplanada). A planilha-mestre ainda
 * usa Andrômeda e São João.
 *
 * Uso: node scripts/leads-periodo.js AAAA-MM-DD AAAA-MM-DD   (fim inclusivo)
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const [, , DE, ATE] = process.argv;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DE || "") || !/^\d{4}-\d{2}-\d{2}$/.test(ATE || "")) {
  console.error("uso: node scripts/leads-periodo.js AAAA-MM-DD AAAA-MM-DD");
  process.exit(1);
}
const MAPA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src/lib/departamentos.json"), "utf-8")
).departamentos;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};

/** "Locação Dutra" -> ["LOCAÇÃO","Dutra"]; o que não casa (Diretoria, CPD) vira null. */
const separa = (nome) => {
  if (!nome) return null;
  const m = nome.match(/^(?:Gerente\s+)?(Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  if (!m) return null;
  return [/^loca/i.test(m[1]) ? "LOCAÇÃO" : "VENDAS", m[2].trim()];
};
const num = (n) => Number(n).toLocaleString("pt-BR");

(async () => {
  const { rows } = await q(`
    SELECT l.id, l.locacao_venda,
      (SELECT u.departamento_id
         FROM lead_responsaveis r JOIN corretores u ON u.id = r.corretor_id
        WHERE r.lead_id = l.id
        ORDER BY r.data ASC NULLS LAST, r.id ASC LIMIT 1) AS dep,
      (SELECT COALESCE(NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''))
         FROM lead_responsaveis r JOIN corretores u ON u.id = r.corretor_id
        WHERE r.lead_id = l.id
        ORDER BY r.data ASC NULLS LAST, r.id ASC LIMIT 1) AS quem
    FROM leads l
    WHERE l.data_inicio >= $1::date AND l.data_inicio < ($2::date + 1)`, [DE, ATE]);

  const porOper = { VENDAS: 0, "LOCAÇÃO": 0 };
  const porUni = new Map();
  const foraDeUnidade = new Map();   // Diretoria, CPD, Secretaria... têm depto, mas não de unidade
  let semResponsavel = 0;
  let divergeTipo = 0;

  for (const x of rows) {
    if (!x.dep) { semResponsavel++; continue; }
    const nomeDep = MAPA[String(x.dep)];
    const sep = separa(nomeDep);
    if (!sep) {
      const k = nomeDep || `departamento ${x.dep}`;
      foraDeUnidade.set(k, (foraDeUnidade.get(k) || 0) + 1);
      continue;
    }
    const [oper, uni] = sep;
    porOper[oper]++;
    if (!porUni.has(uni)) porUni.set(uni, { VENDAS: 0, "LOCAÇÃO": 0 });
    porUni.get(uni)[oper]++;
    // o que `leads.locacao_venda` diria
    const doCampo = x.locacao_venda === "L" ? "LOCAÇÃO" : x.locacao_venda === "V" ? "VENDAS" : null;
    if (doCampo && doCampo !== oper) divergeTipo++;
  }

  const classificados = porOper.VENDAS + porOper["LOCAÇÃO"];
  const foraTotal = [...foraDeUnidade.values()].reduce((s, n) => s + n, 0);

  console.log(`LEADS RECEBIDOS — ${DE.split("-").reverse().join("/")} a ${ATE.split("-").reverse().join("/")}`);
  console.log("=".repeat(62));
  console.log(`TOTAL DE LEADS NO PERÍODO ............ ${num(rows.length).padStart(8)}`);
  console.log(`  atribuídos a uma unidade ........... ${num(classificados).padStart(8)}`);
  console.log(`  sem nenhum responsável ............. ${num(semResponsavel).padStart(8)}`);
  console.log(`  responsável fora de unidade ........ ${num(foraTotal).padStart(8)}`);

  console.log(`\nPOR OPERAÇÃO (dos ${num(classificados)} atribuídos)`);
  for (const o of ["VENDAS", "LOCAÇÃO"]) {
    const pct = classificados ? (100 * porOper[o] / classificados).toFixed(1) : "0";
    console.log(`  ${o.padEnd(10)} ${num(porOper[o]).padStart(8)}   ${pct}%`);
  }

  console.log(`\nPOR UNIDADE`);
  console.log(`  ${"UNIDADE".padEnd(14)}${"VENDAS".padStart(9)}${"LOCAÇÃO".padStart(10)}${"TOTAL".padStart(9)}`);
  const lista = [...porUni.entries()]
    .map(([u, v]) => ({ u, ...v, total: v.VENDAS + v["LOCAÇÃO"] }))
    .sort((a, b) => b.total - a.total);
  for (const x of lista) {
    console.log(`  ${x.u.padEnd(14)}${num(x.VENDAS).padStart(9)}${num(x["LOCAÇÃO"]).padStart(10)}${num(x.total).padStart(9)}`);
  }
  console.log(`  ${"TOTAL".padEnd(14)}${num(porOper.VENDAS).padStart(9)}${num(porOper["LOCAÇÃO"]).padStart(10)}${num(classificados).padStart(9)}`);

  if (foraDeUnidade.size) {
    console.log(`\nRESPONSÁVEL SEM UNIDADE COMERCIAL (ficam fora do quadro acima)`);
    for (const [k, n] of [...foraDeUnidade].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${num(n).padStart(6)} · ${k}`);
    }
  }
  console.log(`\nconferência: ${num(divergeTipo)} lead(s) em que o campo locacao_venda discorda do departamento do 1º responsável`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
