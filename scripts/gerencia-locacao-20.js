#!/usr/bin/env node
/**
 * Gerência de locação: 10% -> 20% (01/10/2026).
 *
 * O Jonatan corrigiu a informação que tinha dado horas antes ("gerente de
 * locação são 10% mesmo"): o certo é **20%**. A composição completa da
 * locação passa a ser
 *
 *     gerência 20% + fechamento 30% + captação 10% + diretoria 3% = 63%
 *
 * e não os 53% que o BI vinha usando. Com Dimas, Girotto ou Mauro na
 * captação, ela sobe para 20% e o fechamento cai para 20% — a soma continua
 * 63% (ver `scripts/captacao-20-mauro-girotto.js`).
 *
 * A base corrobora: cinco locações já tinham sido lançadas com gerência de
 * 20% e somavam exatamente 63%, inclusive a #879, que é a única que já trazia
 * a captação de 20% do Mauro. O BI é que estava atrás da regra.
 *
 * O que isso custa: **R$ 92.533,38** a mais de comissão de gerência nas 394
 * locações já lançadas, saindo da parte da imobiliária. Ninguém passa a dever
 * nada — percentual que sobe só aumenta o saldo a receber, e quem já recebeu
 * continua com o que recebeu.
 *
 * Toca só nas linhas que estão exatamente em 10%: as cinco que já estavam em
 * 20% ficam como estão, e não há nenhuma locação com mais de uma linha de
 * gerência (conferido).
 *
 * Uso: node scripts/gerencia-locacao-20.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
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

(async () => {
  const alvo = `
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE rc.papel = 'gerencia' AND p.tipo = 'locacao' AND rc.percentual = 0.10`;

  const { rows: antes } = await q(`
    SELECT count(*)::int linhas, round(sum(n.valor * 0.10), 2)::float a_mais ${alvo}`);
  console.log(`linhas de gerência em locação a 10%: ${antes[0].linhas}`);
  console.log(`comissão adicional que isso gera: R$ ${antes[0].a_mais}`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const r = await q(`
    UPDATE fechamento_negocio_corretores SET percentual = 0.20
    WHERE id IN (SELECT rc.id ${alvo})`);
  console.log(`\natualizadas: ${r.rowCount} linhas`);

  const { rows: somas } = await q(`
    WITH s AS (SELECT n.id, n.periodo_id, round(sum(rc.percentual)*100, 2)::float soma
               FROM fechamento_negocios n
               JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
               WHERE NOT n.cancelado GROUP BY n.id)
    SELECT s.soma, count(*)::int negocios
    FROM s JOIN fechamento_periodos p ON p.id = s.periodo_id
    WHERE p.tipo = 'locacao' GROUP BY 1 ORDER BY 2 DESC`);
  console.log("\nsoma do rateio nas locações agora:");
  console.table(somas);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
