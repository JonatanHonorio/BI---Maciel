#!/usr/bin/env node
/**
 * Põe nas vendas já lançadas o VALOR REAL do contrato, no lugar da conta dos
 * 6% (08/10/2026). **Não rode sem a decisão do Jonatan** — por padrão só mostra.
 *
 * O PORQUÊ. Até 08/10 o BI derivava o valor da venda de uma taxa fixa de 6%, e
 * a adm nem via esse campo. Só que a taxa varia: dos 132 contratos de venda
 * que casam com o Kurole, **84 estão em 6% e 48 não**, de 2,7% a 9,1%. O
 * resultado é um VGV sistematicamente errado — e é o VGV que decide o ranking
 * de quem mais vendeu.
 *
 * O formulário já foi corrigido e passa a trazer o valor do contrato. Este
 * script é a parte retroativa.
 *
 * ⚠️ NÃO MEXE EM COMISSÃO. Só no `valor`, que em venda é informativo: o rateio
 * é percentual sobre a COMISSÃO, então nenhum centavo de repasse muda aqui.
 * O que muda é o VGV dos relatórios e do ranking.
 *
 * ⚠️ Só toca em negócio cujo CT casa com UMA conversão de venda no Kurole.
 * Fica de fora:
 *  - quem não tem número de contrato (332 das 468 vendas);
 *  - o CT 271, que está repetido em duas vendas (refs 53287 e 63369) — com o
 *    número duplicado não dá para saber de quem é o valor, e chutar seria
 *    trocar um erro conhecido por um invisível.
 *
 * Uso: node scripts/vgv-valor-real-do-contrato.js [--aplicar]
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
const br = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { rows } = await q(`
    WITH ct AS (
      SELECT n.id, n.ref, p.unidade, to_char(p.competencia,'MM/YYYY') comp,
             n.valor::float valor_bi, n.comissao::float comissao,
             NULLIF(regexp_replace(COALESCE(n.contrato,''),'\\D','','g'),'')::int numero
      FROM fechamento_negocios n
      JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'venda'
      WHERE NOT n.cancelado AND n.valor IS NOT NULL)
    SELECT ct.*, c.valor::float valor_real, c.taxa::float taxa,
           (SELECT count(*) FROM fechamento_negocios n2
            JOIN fechamento_periodos p2 ON p2.id = n2.periodo_id AND p2.tipo='venda'
            WHERE NOT n2.cancelado
              AND NULLIF(regexp_replace(COALESCE(n2.contrato,''),'\\D','','g'),'')::int = ct.numero)::int usos_do_ct
    FROM ct
    JOIN conversoes c ON c.contrato_numero = ct.numero AND c.locacao_venda = 'V' AND c.valor > 0
    WHERE ct.numero IS NOT NULL`);

  const duplicados = rows.filter((r) => r.usos_do_ct > 1);
  const alvo = rows.filter((r) => r.usos_do_ct === 1 && Math.abs(r.valor_bi - r.valor_real) > 1);

  console.log(`vendas com CT que casa no Kurole: ${rows.length}`);
  console.log(`fora por CT repetido: ${duplicados.length} (${[...new Set(duplicados.map((d) => d.ref))].join(", ")})`);
  console.log(`a corrigir: ${alvo.length}`);

  const somaBI = alvo.reduce((s, r) => s + r.valor_bi, 0);
  const somaReal = alvo.reduce((s, r) => s + r.valor_real, 0);
  console.log(`\nVGV dessas vendas hoje:  R$ ${br(somaBI)}`);
  console.log(`VGV pelo contrato:       R$ ${br(somaReal)}`);
  console.log(`entra no VGV:            R$ ${br(somaReal - somaBI)}`);

  const porUnidade = {};
  alvo.forEach((r) => {
    porUnidade[r.unidade] ??= { vendas: 0, hoje: 0, real: 0 };
    porUnidade[r.unidade].vendas++;
    porUnidade[r.unidade].hoje += r.valor_bi;
    porUnidade[r.unidade].real += r.valor_real;
  });
  console.log("\npor unidade:");
  console.table(Object.entries(porUnidade)
    .map(([unidade, v]) => ({
      unidade, vendas: v.vendas,
      vgv_hoje: Math.round(v.hoje), vgv_real: Math.round(v.real),
      entra: Math.round(v.real - v.hoje),
    }))
    .sort((a, b) => b.entra - a.entra));

  console.log("\nas 10 maiores mudanças:");
  console.table(alvo
    .sort((a, b) => Math.abs(b.valor_real - b.valor_bi) - Math.abs(a.valor_real - a.valor_bi))
    .slice(0, 10)
    .map((r) => ({
      ref: r.ref, ct: r.numero, unidade: r.unidade, comp: r.comp,
      hoje: Math.round(r.valor_bi), real: Math.round(r.valor_real),
      taxa: r.taxa + "%", comissao: r.comissao,
    })));

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  for (const r of alvo) {
    await q(`UPDATE fechamento_negocios SET valor = $2, atualizado_em = NOW() WHERE id = $1`,
      [r.id, r.valor_real]);
  }
  console.log(`\nvendas atualizadas: ${alvo.length}`);

  // Rede de segurança: nenhuma comissão pode ter mudado.
  const [{ n }] = (await q(`
    SELECT count(*)::int n FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios ng ON ng.id = rc.negocio_id AND NOT ng.cancelado
    JOIN fechamento_periodos p ON p.id = ng.periodo_id
    WHERE COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                    WHERE fp.negocio_corretor_id = rc.id), 0)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN ng.comissao ELSE ng.valor END) + 0.01`)).rows;
  console.log("linhas com pagamento acima do devido (tem que ser 0):", n);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
