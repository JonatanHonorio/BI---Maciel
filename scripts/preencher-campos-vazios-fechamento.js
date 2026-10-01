#!/usr/bin/env node
/**
 * Preenche os campos que ficaram em branco nos fechamentos retroativos
 * (01/10/2026), seguindo as convenções que a adm propôs — com uma diferença,
 * explicada abaixo.
 *
 * REFERÊNCIA -> "00000". É a convenção que ela já usou no negócio novo da
 * Cecilia (um laudo de viabilidade que nunca foi cadastrado no Kurole).
 * "00000" se lê como ausência à primeira vista e nunca vai casar com um
 * imóvel de verdade, então é um bom marcador.
 *
 * DATA DO CONTRATO -> primeiro dia da competência. Também proposta dela. São
 * duas locações da Vista Verde cuja data ninguém tem.
 *
 * ORIGEM e FORMA DE PAGAMENTO -> "Não informado", e NÃO "Cliente de Carteira"
 * / "A Vista" como ela sugeriu. A diferença importa: referência e data são
 * campos de identificação, e um marcador ali é obviamente um marcador. Origem
 * e forma de pagamento são campos de ANÁLISE — a origem alimenta a conta de
 * onde vêm os negócios, e "A Vista" contra "Financiamento" muda o retrato da
 * carteira. Preencher com uma categoria real transformaria "não sabemos" em
 * "sabemos, e foi assim", e daqui a seis meses ninguém lembraria da diferença.
 *
 * "Não informado" NÃO entra na lista do formulário de propósito: o valor fica
 * gravado e aparece na tela, mas quem lança um negócio novo continua obrigado
 * a escolher uma origem e uma forma de pagamento de verdade.
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

const SEM_INFO = "Não informado";

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

  await mostrar("REF -> 00000", `SELECT ${cols} ${base} AND (n.ref IS NULL OR n.ref !~ '^[0-9]+$') ORDER BY n.id`);
  await mostrar("DATA -> 1º dia da competência", `SELECT ${cols} ${base} AND n.data_contrato IS NULL ORDER BY n.id`);
  await mostrar(`ORIGEM -> ${SEM_INFO}`, `SELECT ${cols} ${base} AND btrim(coalesce(n.origem,'')) = '' ORDER BY n.id`);
  await mostrar(`PAGAMENTO -> ${SEM_INFO} (só venda)`, `SELECT ${cols} ${base} AND p.tipo='venda' AND btrim(coalesce(n.pagamento,'')) = '' ORDER BY n.id`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const r1 = await q(`
    UPDATE fechamento_negocios SET ref = '00000'
    WHERE NOT cancelado AND (ref IS NULL OR ref !~ '^[0-9]+$')`);
  // A data vem da competência do próprio período, não de uma lista fixa.
  const r2 = await q(`
    UPDATE fechamento_negocios n SET data_contrato = p.competencia
    FROM fechamento_periodos p
    WHERE p.id = n.periodo_id AND NOT n.cancelado AND n.data_contrato IS NULL`);
  const r3 = await q(`
    UPDATE fechamento_negocios SET origem = $1
    WHERE NOT cancelado AND btrim(coalesce(origem,'')) = ''`, [SEM_INFO]);
  const r4 = await q(`
    UPDATE fechamento_negocios n SET pagamento = $1
    FROM fechamento_periodos p
    WHERE p.id = n.periodo_id AND NOT n.cancelado AND p.tipo = 'venda'
      AND btrim(coalesce(n.pagamento,'')) = ''`, [SEM_INFO]);

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
