#!/usr/bin/env node
/**
 * Correções de digitação do fechamento apuradas na auditoria de 30/09/2026,
 * antes de desligar `PERMITE_NOME_LIVRE_NO_RATEIO`.
 *
 * Três blocos, todos autorizados pelo Jonatan ("pode corrigir as datas, o
 * rateio e ligar os nomes"):
 *
 * 1. DATAS. Só as que têm prova. Duas saem do próprio Kurole (a data de
 *    assinatura do contrato), duas são ano impossível ou ano trocado num
 *    negócio cujos irmãos do mesmo loteamento têm a data certa. As duas que
 *    ficaram sem prova (#45 e #461) NÃO entram aqui de propósito — chutar
 *    data de contrato é pior do que deixar visível que está errada.
 *
 * 2. RATEIO. O percentual de gerência digitado em dobro, e o bloco de
 *    captação que faltava num negócio cujo captador o Kurole conhece. O
 *    terceiro caso (#786) fica de fora: o negócio está sem referência, então
 *    não há como saber quem captou.
 *
 * 3. NOMES. Liga ao cadastro do Kurole as linhas de rateio que foram
 *    digitadas à mão mas têm correspondência única. Fora ficaram: "Doris"
 *    (trabalhou no lançamento, já saiu e nunca teve cadastro — fica por nome,
 *    decisão do Jonatan), "Rita" (casa com duas pessoas) e os nomes sem
 *    cadastro nenhum.
 *
 * Uso: node scripts/corrigir-digitacao-fechamento.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: cada correção só age se o valor
 * errado ainda estiver lá.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

// A conexão com o Neon cai de vez em quando nesta máquina.
const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

const DATAS = [
  { id: 167, de: "12026-01-01", para: "2026-01-01", porque: "ano com 5 dígitos" },
  { id: 29, de: "2026-12-01", para: "2025-12-01", porque: "competência 12/2025; os outros lotes da ref 58298 na Urbanova estão em 01/12/2025" },
  { id: 485, de: "2026-12-18", para: "2025-12-18", porque: "contrato 3936 no Kurole: assinatura 18/12/2025" },
  { id: 287, de: "2026-07-30", para: "2026-04-30", porque: "contrato 331 no Kurole: assinatura 30/04/2026" },
];

const RATEIO_PCT = [
  { negocio: 538, papel: "gerencia", de: 0.20, para: 0.10, porque: "gerência é 10%; 20% deixava o rateio em 63%" },
];

const RATEIO_FALTANDO = [
  { negocio: 818, papel: "levantamento", corretor: 291, pct: 0.10,
    porque: "rateio em 43% sem o bloco de captação; o Kurole dá Rachel Souza como captadora de 100% do imóvel 58125 em locação" },
];

// nome digitado -> id do corretor no cadastro
const NOMES = [
  ["Matheus Yan Vieira Ferraro", 857], ["Matheus Vieira", 857],
  ["Gabriela Silva", 821], ["Jean Silva", 883], ["Carlos Alberto Carvalho", 646],
  ["Diego Guimarães", 807], ["Heitor Barbosa", 175], ["Thiago Silva", 834],
  ["Tiago Lucas", 876], ["Alex Roque", 894], ["Christian", 148],
  ["Daiana Carvalho", 369], ["Fabiana Oliveira", 347], ["Ilza", 95],
  ["Inácio Mendes", 130], ["Joshua Marcondes Pereira da Silva", 970],
  ["Leandro", 383], ["Luziane", 485], ["Mariane Oliveira", 899],
  ["Marina", 878], ["Marta Silva", 154], ["Poliana.Nascimento", 924],
  ["Priscila Saito", 502], ["Taina Chagas", 792], ["Talita Souza", 742],
  ["Thomaz", 303], ["Vanessa Gomes", 709], ["Victoria", 815],
  // O ponto no lugar do espaço denuncia o copiar/colar de um login.
  ["Zeze.Maciel", 83],
  // Confirmados pelo Jonatan em 30/09/2026, e os dois continuam na empresa —
  // por isso precisavam entrar no ranking. Nenhum dos dois casa por sobrenome:
  // no cadastro não existe "Tokio" nem "Katie", que são como os chamam na
  // casa. Só o Jonatan poderia dizer, e disse.
  ["Karine Katie", 165],   // Karine Bashiyo
  ["Ricardo Tokio", 169],  // Ricardo Silva
];

(async () => {
  console.log("== DATAS ==");
  for (const d of DATAS) {
    const [linha] = (await q(
      `SELECT to_char(data_contrato,'YYYY-MM-DD') atual FROM fechamento_negocios WHERE id = $1`, [d.id]
    )).rows;
    if (!linha) { console.log(`  #${d.id} não existe mais`); continue; }
    if (linha.atual !== d.de) { console.log(`  #${d.id} já está ${linha.atual} — pulado`); continue; }
    console.log(`  #${d.id} ${d.de} -> ${d.para}  (${d.porque})`);
    if (APLICAR) {
      await q(`UPDATE fechamento_negocios SET data_contrato = $2 WHERE id = $1 AND data_contrato = $3`,
        [d.id, d.para, d.de]);
    }
  }

  console.log("\n== RATEIO: percentual errado ==");
  for (const r of RATEIO_PCT) {
    const linhas = (await q(
      `SELECT id, percentual::float pct FROM fechamento_negocio_corretores
       WHERE negocio_id = $1 AND papel = $2`, [r.negocio, r.papel]
    )).rows;
    const alvo = linhas.filter((l) => Math.abs(l.pct - r.de) < 1e-9);
    if (!alvo.length) { console.log(`  #${r.negocio} ${r.papel} não está em ${r.de * 100}% — pulado`); continue; }
    console.log(`  #${r.negocio} ${r.papel}: ${r.de * 100}% -> ${r.para * 100}%  (${r.porque})`);
    if (APLICAR) {
      await q(`UPDATE fechamento_negocio_corretores SET percentual = $2 WHERE id = ANY($1::int[])`,
        [alvo.map((l) => l.id), r.para]);
    }
  }

  console.log("\n== RATEIO: bloco faltando ==");
  for (const r of RATEIO_FALTANDO) {
    const [{ existe }] = (await q(
      `SELECT count(*)::int existe FROM fechamento_negocio_corretores WHERE negocio_id = $1 AND papel = $2`,
      [r.negocio, r.papel]
    )).rows;
    if (existe) { console.log(`  #${r.negocio} já tem ${r.papel} — pulado`); continue; }
    console.log(`  #${r.negocio}: + ${r.papel} ${r.pct * 100}% para o corretor ${r.corretor}  (${r.porque})`);
    if (APLICAR) {
      await q(
        `INSERT INTO fechamento_negocio_corretores (negocio_id, papel, corretor_id, percentual)
         VALUES ($1, $2, $3, $4)`, [r.negocio, r.papel, r.corretor, r.pct]
      );
    }
  }

  console.log("\n== NOMES -> CADASTRO ==");
  let total = 0;
  for (const [nome, id] of NOMES) {
    const [{ n }] = (await q(
      `SELECT count(*)::int n FROM fechamento_negocio_corretores
       WHERE corretor_id IS NULL AND TRIM(nome_livre) = $1
         AND papel IN ('levantamento','fechamento','gerencia','lancamento')`, [nome]
    )).rows;
    if (!n) continue;
    const [cad] = (await q(
      `SELECT COALESCE(NULLIF(TRIM(nome_comercial),''),nome) nome, ativo FROM corretores WHERE id = $1`, [id]
    )).rows;
    if (!cad) { console.log(`  !! corretor ${id} não existe — "${nome}" fica como está`); continue; }
    total += n;
    console.log(`  "${nome}" -> #${id} ${cad.nome}${cad.ativo ? " [ativo]" : ""} · ${n} linha(s)`);
    if (APLICAR) {
      await q(
        `UPDATE fechamento_negocio_corretores SET corretor_id = $2, nome_livre = NULL
         WHERE corretor_id IS NULL AND TRIM(nome_livre) = $1
           AND papel IN ('levantamento','fechamento','gerencia','lancamento')`, [nome, id]
      );
    }
  }
  console.log(`  ${APLICAR ? "religadas" : "a religar"}: ${total} linhas`);

  if (!APLICAR) console.log("\n(simulação — rode com --aplicar para gravar)");
  else {
    const [s] = (await q(
      `SELECT count(*) FILTER (WHERE rc.corretor_id IS NULL)::int digitadas,
              count(DISTINCT TRIM(rc.nome_livre)) FILTER (WHERE rc.corretor_id IS NULL)::int nomes
       FROM fechamento_negocio_corretores rc
       JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
       WHERE rc.papel IN ('levantamento','fechamento','gerencia','lancamento')`
    )).rows;
    console.log(`\nsobram ${s.digitadas} linhas por nome digitado, em ${s.nomes} nomes`);
  }

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
