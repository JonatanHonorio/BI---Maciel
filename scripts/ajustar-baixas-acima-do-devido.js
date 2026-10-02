#!/usr/bin/env node
/**
 * Acerta as baixas de comissão que ficaram ACIMA do devido depois da mudança
 * de percentual (02/10/2026).
 *
 * De onde vem o descompasso: a Mayra lançou os recebimentos retroativos em
 * 30/09 e o BI distribuiu a comissão sozinho, com os percentuais daquele
 * momento — fechamento em 30%. Dois dias depois a regra da captação do
 * Girotto desceu o fechamento desses negócios para 20%, e a baixa antiga
 * passou a valer mais do que a pessoa tem a receber.
 *
 * Ninguém lançou esses pagamentos à mão: são a divisão automática do
 * recebimento. O Jonatan confirmou que é para deixar a baixa no valor certo e
 * que, se algum repasse já tiver saído diferente, as adms avisam ao lançar.
 *
 * O que o script NÃO faz: completar quem recebeu MENOS do que o novo devido.
 * O Girotto, por exemplo, passou a ter 20% de captação e a baixa dele continua
 * nos 10% antigos — isso é saldo a receber de verdade, e marcar como pago
 * inventaria um repasse que não aconteceu.
 *
 * Uso: node scripts/ajustar-baixas-acima-do-devido.js [--aplicar]
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
  // Linhas com UMA baixa só e pago > devido: aí dá pra acertar o valor sem
  // escolher qual das baixas mexer.
  const { rows: alvo } = await q(`
    SELECT rc.id AS linha, n.ref, p.unidade, to_char(p.competencia,'MM/YYYY') comp, rc.papel,
           COALESCE(NULLIF(TRIM(k.nome_comercial),''), k.nome, rc.nome_livre) nome,
           round(rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END), 2)::float devido,
           (SELECT count(*)::int FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id) baixas,
           (SELECT min(fp.id) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id) baixa,
           (SELECT sum(fp.valor) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id)::float pago
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE (SELECT COALESCE(sum(fp.valor),0) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END) + 0.01
    ORDER BY n.ref`);

  console.log(`linhas com baixa acima do devido: ${alvo.length}`);
  alvo.forEach((a) =>
    console.log(`   ref ${a.ref} ${a.unidade} ${a.comp} · ${a.nome} (${a.papel}): pago R$ ${a.pago} -> devido R$ ${a.devido}` +
      (a.baixas > 1 ? `  ⚠ ${a.baixas} baixas, precisa de acerto manual` : ""))
  );

  const simples = alvo.filter((a) => a.baixas === 1);
  if (!APLICAR) {
    console.log(`\n${simples.length} com uma baixa só, dá pra acertar direto`);
    console.log("(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  for (const a of simples) {
    await q(`UPDATE fechamento_pagamentos SET valor = $2 WHERE id = $1`, [a.baixa, a.devido]);
  }
  console.log(`\nbaixas acertadas: ${simples.length}`);

  const { rows: sobrou } = await q(`
    SELECT count(*)::int linhas FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE (SELECT COALESCE(sum(fp.valor),0) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END) + 0.01`);
  console.log("linhas ainda acima do devido:", sobrou[0].linhas);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
