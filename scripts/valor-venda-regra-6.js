#!/usr/bin/env node
/**
 * Devolve o VALOR das vendas à regra da casa: **valor = comissão ÷ 6%**
 * (09/10/2026). Por padrão só mostra; grava com --aplicar.
 *
 * O PORQUÊ. Em 08/10 eu troquei o valor das vendas pelo valor real do contrato
 * do Kurole, achando que a conta dos 6% era um defeito — a taxa real varia de
 * 2,7% a 9,1%, e o VGV "subia" R$ 4,8 milhões. Estava errado sobre o que a
 * coluna significa.
 *
 * A coluna Valor do fechamento NÃO é o preço pelo qual o imóvel foi vendido.
 * É uma convenção interna definida pelo Sr. Maciel e é assim que o BI foi
 * construído: a adm lança a COMISSÃO, e o valor do imóvel é essa comissão
 * transformada em 6%. Quando a comissão é negociada acima ou abaixo, o valor
 * acompanha a comissão — de propósito. Puxar o contrato fazia a tela divergir
 * do que as adms lançam, que foi o que a Tatiane apontou.
 *
 * Então o valor de venda no fechamento é informação derivada, não medida. Quem
 * quiser o preço de mercado olha o Kurole.
 *
 * ⚠️ NÃO MEXE EM COMISSÃO, e por isso não mexe em repasse: o rateio de venda é
 * percentual sobre a COMISSÃO. O que muda é o VGV dos relatórios e do ranking,
 * que volta ao que era antes de 08/10.
 *
 * ⚠️ Só venda. Em locação o rateio incide sobre o VALOR, e ali o valor é o
 * valor do aluguel mesmo — mexer seria mexer em dinheiro.
 *
 * Uso: node scripts/valor-venda-regra-6.js [--aplicar]
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const TAXA = 0.06;

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};
const br = (n) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { rows } = await q(`
    SELECT n.id, n.ref, p.unidade, to_char(p.competencia,'MM/YYYY') comp, p.status,
           n.valor::float valor, n.comissao::float comissao,
           (n.atualizado_em::date = CURRENT_DATE) mexido_hoje
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'venda'
    WHERE NOT n.cancelado AND n.comissao IS NOT NULL AND n.comissao > 0`);

  const alvo = rows
    .map((r) => ({ ...r, devido: r.comissao / TAXA }))
    .filter((r) => Math.abs((r.valor ?? 0) - r.devido) > 0.01);

  console.log(`vendas ativas: ${rows.length}`);
  console.log(`fora da regra: ${alvo.length}`);
  console.log(`  das quais alteradas ontem/hoje pelo script do contrato: ${alvo.filter((r) => r.mexido_hoje).length}`);
  console.log(`  já estavam fora antes disso: ${alvo.filter((r) => !r.mexido_hoje).length}`);

  const somaHoje = alvo.reduce((s, r) => s + (r.valor ?? 0), 0);
  const somaRegra = alvo.reduce((s, r) => s + r.devido, 0);
  console.log(`\nVGV dessas hoje:   R$ ${br(somaHoje)}`);
  console.log(`VGV pela regra:    R$ ${br(somaRegra)}`);
  console.log(`sai do VGV:        R$ ${br(somaHoje - somaRegra)}`);

  const porUnidade = {};
  alvo.forEach((r) => {
    porUnidade[r.unidade] ??= { vendas: 0, hoje: 0, regra: 0 };
    porUnidade[r.unidade].vendas++;
    porUnidade[r.unidade].hoje += r.valor ?? 0;
    porUnidade[r.unidade].regra += r.devido;
  });
  console.log("\npor unidade:");
  console.table(Object.entries(porUnidade)
    .map(([unidade, v]) => ({ unidade, vendas: v.vendas,
      vgv_hoje: Math.round(v.hoje), vgv_regra: Math.round(v.regra), sai: Math.round(v.hoje - v.regra) }))
    .sort((a, b) => b.sai - a.sai));

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  for (const r of alvo) {
    await q(`UPDATE fechamento_negocios SET valor = $2, atualizado_em = NOW() WHERE id = $1`,
      [r.id, Number(r.devido.toFixed(2))]);
  }
  console.log(`\nvendas atualizadas: ${alvo.length}`);

  // Conferências: a regra passa a valer em todas, e nenhum repasse se mexeu.
  const [{ n: sobrou }] = (await q(`
    SELECT count(*)::int n FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'venda'
    WHERE NOT n.cancelado AND n.comissao > 0 AND abs(n.valor - n.comissao / 0.06) > 0.01`)).rows;
  console.log("vendas ainda fora da regra (tem que ser 0):", sobrou);

  const [{ n: acima }] = (await q(`
    SELECT count(*)::int n FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios ng ON ng.id = rc.negocio_id AND NOT ng.cancelado
    JOIN fechamento_periodos p ON p.id = ng.periodo_id
    WHERE COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                    WHERE fp.negocio_corretor_id = rc.id), 0)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN ng.comissao ELSE ng.valor END) + 0.01`)).rows;
  console.log("linhas com pagamento acima do devido (tem que ser 0):", acima);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
