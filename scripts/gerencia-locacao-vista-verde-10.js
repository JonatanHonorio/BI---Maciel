#!/usr/bin/env node
/**
 * Gerência da LOCAÇÃO da Vista Verde volta para 10% (04/10/2026).
 *
 * A regra geral da locação é gerência de 20%, mas a Vista Verde é exceção: "a
 * Gisela é a única gerente de locação que recebe 10%; nas locações da Vista
 * Verde a Maciel fica com uma parte maior da comissão". Em 02/10 eu tinha
 * subido TODAS as locações para 20%, inclusive as dela.
 *
 * A exceção vale pela UNIDADE, e não pela pessoa: é a unidade que define
 * quanto o negócio inteiro distribui. Locação da Vista Verde fecha em **53%**
 * (10 + 30 + 10 + 3); as demais, em 63%.
 *
 * Nenhuma dessas linhas tem baixa de comissão lançada — conferido antes de
 * mexer —, então não há repasse a desfazer: são R$ 20.840,99 que voltam para
 * a parte da imobiliária.
 *
 * Uso: node scripts/gerencia-locacao-vista-verde-10.js [--aplicar]
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

const ALVO = `
  FROM fechamento_negocio_corretores rc
  JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
  JOIN fechamento_periodos p ON p.id = n.periodo_id
  WHERE rc.papel = 'gerencia' AND p.tipo = 'locacao'
    AND p.unidade = 'Vista Verde' AND rc.percentual = 0.20`;

(async () => {
  const [antes] = (await q(`
    SELECT count(*)::int linhas, round(sum(n.valor * 0.10), 2)::float volta_pra_imobiliaria,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id))::int com_baixa
    ${ALVO}`)).rows;
  console.log(`linhas de gerência a 20% na locação da Vista Verde: ${antes.linhas}`);
  console.log(`volta para a imobiliária: R$ ${antes.volta_pra_imobiliaria}`);
  console.log(`com baixa de comissão já lançada: ${antes.com_baixa}`);

  if (antes.com_baixa > 0) {
    console.log("\n⚠ há baixa lançada: baixar o percentual deixaria alguém com mais recebido do que devido. Confira antes.");
  }
  if (!APLICAR) { console.log("\n(simulação — rode com --aplicar para gravar)"); await pool.end(); return; }

  const r = await q(`UPDATE fechamento_negocio_corretores SET percentual = 0.10 WHERE id IN (SELECT rc.id ${ALVO})`);
  console.log(`\natualizadas: ${r.rowCount}`);

  const { rows: somas } = await q(`
    WITH s AS (SELECT n.id, p.unidade, round(sum(rc.percentual)*100, 2)::float soma
               FROM fechamento_negocios n
               JOIN fechamento_periodos p ON p.id = n.periodo_id
               JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
               WHERE NOT n.cancelado AND p.tipo = 'locacao' GROUP BY n.id, p.unidade)
    SELECT unidade, soma, count(*)::int negocios FROM s GROUP BY 1, 2 ORDER BY 1, 2`);
  console.log("\nsoma do rateio nas locações, por unidade:");
  console.table(somas);
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
