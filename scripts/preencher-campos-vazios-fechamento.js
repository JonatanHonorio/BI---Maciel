#!/usr/bin/env node
/**
 * Preenche os campos que ficaram em branco nos fechamentos retroativos
 * (01/10/2026), seguindo as convenções que a adm propôs — com uma diferença,
 * explicada abaixo.
 *
 * REFERÊNCIA -> "0000". Marcador de referência perdida: o Jonatan confirmou
 * em 01/10/2026 que esses negócios tiveram a referência perdida no banco. Ele
 * pediu quatro zeros; a adm tinha usado cinco num negócio, e os onze foram
 * padronizados em "0000" para uma busca achar todos de uma vez.
 *
 * DATA DO CONTRATO -> primeiro dia da competência. Também proposta dela. São
 * duas locações da Vista Verde cuja data ninguém tem.
 *
 * ORIGEM -> "Cliente de Carteira" e FORMA DE PAGAMENTO -> "A Vista", como a
 * adm pediu. Eu tinha gravado "Não informado" nos dois e levantado a ressalva:
 * referência e data são campos de identificação, onde um marcador se lê como
 * marcador, mas origem e forma de pagamento se leem como fato — daqui a seis
 * meses ninguém lembra que foram preenchidos no escuro. O Jonatan decidiu em
 * 01/10/2026 pelo que a adm pediu, ciente disso.
 *
 * Pesa a favor: hoje nenhum relatório do BI calcula nada em cima desses dois
 * campos; eles só aparecem na tabela do fechamento e no Excel. Se algum dia
 * entrar uma análise por origem, estes 7 negócios de locação de dez/2025 a
 * set/2026 e estas 4 vendas são os que não têm origem de verdade.
 *
 * Uso: node scripts/preencher-campos-vazios-fechamento.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: só toca no que está vazio.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

const ORIGEM_PADRAO = "Cliente de Carteira";
const PAGAMENTO_PADRAO = "A Vista";

(async () => {
  const mostrar = async (titulo, sql) => {
    const { rows } = await q(sql);
    console.log(`\n${titulo}: ${rows.length}`);
    rows.forEach((r) => console.log(`   #${r.id} ${r.unidade} ${r.tipo} ${r.comp} ref ${r.ref ?? "—"}`));
    return rows.length;
  };

  const base = `
    FROM fechamento_negocios n JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE NOT n.cancelado`;
  const cols = `n.id, p.unidade, p.tipo, to_char(p.competencia,'MM/YYYY') comp, n.ref`;

  await mostrar("REF -> 0000", `SELECT ${cols} ${base} AND (n.ref IS NULL OR n.ref !~ '^[0-9]+$') ORDER BY n.id`);
  await mostrar("DATA -> 1º dia da competência", `SELECT ${cols} ${base} AND n.data_contrato IS NULL ORDER BY n.id`);
  await mostrar(`ORIGEM -> ${ORIGEM_PADRAO}`, `SELECT ${cols} ${base} AND btrim(coalesce(n.origem,'')) = '' ORDER BY n.id`);
  await mostrar(`PAGAMENTO -> ${PAGAMENTO_PADRAO} (só venda)`, `SELECT ${cols} ${base} AND p.tipo='venda' AND btrim(coalesce(n.pagamento,'')) = '' ORDER BY n.id`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const r1 = await q(`
    UPDATE fechamento_negocios SET ref = '0000'
    WHERE NOT cancelado AND (ref IS NULL OR ref !~ '^[0-9]+$')`);
  // A data vem da competência do próprio período, não de uma lista fixa.
  const r2 = await q(`
    UPDATE fechamento_negocios n SET data_contrato = p.competencia
    FROM fechamento_periodos p
    WHERE p.id = n.periodo_id AND NOT n.cancelado AND n.data_contrato IS NULL`);
  const r3 = await q(`
    UPDATE fechamento_negocios SET origem = $1
    WHERE NOT cancelado AND btrim(coalesce(origem,'')) = ''`, [ORIGEM_PADRAO]);
  const r4 = await q(`
    UPDATE fechamento_negocios n SET pagamento = $1
    FROM fechamento_periodos p
    WHERE p.id = n.periodo_id AND NOT n.cancelado AND p.tipo = 'venda'
      AND btrim(coalesce(n.pagamento,'')) = ''`, [PAGAMENTO_PADRAO]);

  console.log(`\nref: ${r1.rowCount} · data: ${r2.rowCount} · origem: ${r3.rowCount} · pagamento: ${r4.rowCount}`);

  const [s] = (await q(`
    SELECT count(*) FILTER (WHERE n.ref IS NULL OR n.ref !~ '^[0-9]+$')::int sem_ref,
           count(*) FILTER (WHERE n.data_contrato IS NULL)::int sem_data,
           count(*) FILTER (WHERE btrim(coalesce(n.origem,'')) = '')::int sem_origem,
           count(*) FILTER (WHERE p.tipo='venda' AND btrim(coalesce(n.pagamento,'')) = '')::int sem_pagamento
    ${base}`)).rows;
  console.log("sobrou em branco:", s);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
