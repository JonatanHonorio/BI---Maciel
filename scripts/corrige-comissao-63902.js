#!/usr/bin/env node
/**
 * A venda da ref 63902 foi lançada com comissão de **R$ 10** (08/10/2026).
 *
 * O contrato 477 no Kurole diz: imóvel 63902, valor R$ 200.000, taxa 5%,
 * comissão **R$ 10.000**. Faltaram os milhares na digitação — é o tipo de erro
 * que o campo de taxa, criado no mesmo dia, passa a denunciar na hora (R$ 10
 * sobre R$ 200.000 aparece como 0,005%).
 *
 * Não é julgamento meu sobre o valor do negócio: R$ 10 de comissão numa venda
 * de R$ 200 mil não é uma negociação possível, e o número certo está no
 * contrato. As outras duas divergências que a Tatiane apontou (refs 63369 e
 * 62800) NÃO entram aqui — ali a diferença é de R$ 200 e R$ 500 contra o
 * contrato, que pode muito bem ser acerto combinado, e mexer exigiria
 * confirmação.
 *
 * Condições que tornam isto seguro: o período de 10/2026 ainda está **aberto**
 * e o negócio **não tem nenhuma baixa de comissão** — ninguém recebeu nada em
 * cima do número errado. O rateio é percentual, então ele acompanha sozinho: o
 * devido de cada um sai de centavos para o valor de verdade.
 *
 * Uso: node scripts/corrige-comissao-63902.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const NEGOCIO = 939;
const CT = 477;

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const [n] = (await q(`
    SELECT n.id, n.ref, n.contrato, n.endereco, n.valor::float, n.comissao::float,
           p.unidade, p.tipo, p.status, to_char(p.competencia,'MM/YYYY') comp,
           (SELECT count(*)::int FROM fechamento_pagamentos fp
            JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
            WHERE rc.negocio_id = n.id) baixas
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = $1`, [NEGOCIO])).rows;
  if (!n) throw new Error(`negócio ${NEGOCIO} não existe`);
  if (n.ref !== "63902") throw new Error(`esperava a ref 63902, achei ${n.ref}`);

  const [c] = (await q(`
    SELECT valor::float, taxa::float, comissao_valor::float
    FROM conversoes WHERE contrato_numero = $1 AND locacao_venda = 'V'`, [CT])).rows;
  if (!c) throw new Error(`contrato ${CT} não encontrado no Kurole`);

  console.log(`ref ${n.ref} · CT ${n.contrato} · ${n.unidade} ${n.comp} (${n.status})`);
  console.log(`${n.endereco}`);
  console.log(`\nno BI:        valor R$ ${n.valor.toFixed(2)} · comissão R$ ${n.comissao.toFixed(2)}`);
  console.log(`no contrato:  valor R$ ${c.valor.toFixed(2)} · comissão R$ ${c.comissao_valor.toFixed(2)} (taxa ${c.taxa}%)`);
  console.log(`baixas lançadas: ${n.baixas}`);

  /*
   * Trava: com baixa lançada, subir a comissão criaria saldo a pagar e isso
   * deixa de ser "corrigir digitação" para virar decisão de dinheiro.
   */
  if (n.baixas > 0) {
    throw new Error(`este negócio já tem ${n.baixas} baixa(s) — a correção precisa ser combinada antes`);
  }
  if (Math.abs(n.comissao - c.comissao_valor) < 0.01 && Math.abs(n.valor - c.valor) < 0.01) {
    console.log("\njá está igual ao contrato — nada a fazer.");
    await pool.end();
    return;
  }

  const { rows: antes } = await q(`
    SELECT rc.papel,
           COALESCE(NULLIF(TRIM(k.nome_comercial),''), NULLIF(TRIM(k.nome),''), rc.nome_livre) nome,
           (rc.percentual*100)::float pct,
           (rc.percentual * $2)::float devido_hoje,
           (rc.percentual * $3)::float devido_depois
    FROM fechamento_negocio_corretores rc
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE rc.negocio_id = $1 ORDER BY rc.papel, rc.id`,
    [NEGOCIO, n.comissao, c.comissao_valor]);
  console.log("\no que cada um passa a ter a receber:");
  console.table(antes.map((a) => ({
    papel: a.papel, nome: a.nome, pct: a.pct,
    hoje: Math.round(a.devido_hoje * 100) / 100,
    depois: Math.round(a.devido_depois * 100) / 100,
  })));

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  await q(`
    UPDATE fechamento_negocios SET comissao = $2, valor = $3, atualizado_em = NOW()
    WHERE id = $1`, [NEGOCIO, c.comissao_valor, c.valor]);

  const [d] = (await q(`
    SELECT ref, valor::float, comissao::float FROM fechamento_negocios WHERE id = $1`, [NEGOCIO])).rows;
  console.log(`\ngravado: ref ${d.ref} · valor R$ ${d.valor.toFixed(2)} · comissão R$ ${d.comissao.toFixed(2)}`);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
