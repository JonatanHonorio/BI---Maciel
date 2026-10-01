#!/usr/bin/env node
/**
 * Captação de 20% do Mauro, do Girotto e do Dimas (01/10/2026).
 *
 * A regra, confirmada pelo Jonatan: quando um dos três capta, ele recebe
 * **20%** da comissão em vez dos 10% de tabela, e **os 10% a mais saem do
 * FECHADOR** — o bloco Fechamento cai de 30% para 20%. Não é percentual novo
 * saindo da imobiliária: o negócio continua somando 54,5% em venda e 53% em
 * locação. Vale nas duas verticais e retroativo.
 *
 * O molde veio do único negócio já lançado com a regra, o #879 (Aquarius,
 * locação de setembro): captação 20%, fechamento 20%, total 53%.
 *
 * Em 22 dos casos o captador É o fechador — ele ganha de um lado e perde do
 * outro, e o resultado líquido é zero. Mesmo assim a correção é aplicada: o
 * ranking e o relatório de comissão leem os dois papéis separadamente.
 *
 * O QUE FICA DE FORA, de propósito:
 *
 *  - **Mais de um captador** (4 casos). Com a captação dividida, "20% para
 *    cada" deixaria o bloco em 25% ou 40% e estouraria a soma do negócio. Não
 *    há regra definida para o caso, então ninguém mexe neles.
 *  - **Mais de um fechador** (1 caso, o #492). Tirar 10% de dois fechadores
 *    exige saber de quem sai.
 *  - **Fechador que já recebeu mais do que passaria a dever** (3 casos).
 *    Baixar o percentual deixaria a pessoa devendo à imobiliária, e a tela de
 *    comissões não sabe mostrar isso. Precisa de acerto manual.
 *
 * Uso: node scripts/captacao-20-mauro-girotto.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: quem já está em 20% não é tocado.
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

/** Mauro Souza, José Rafael Girotto e Dimas Barbosa. */
const CAPTADORES = [209, 207, 174];
const NOVA_CAPTACAO = 0.20;
const DIFERENCA = 0.10;

(async () => {
  const negocios = (await q(`
    SELECT DISTINCT n.id, p.tipo, p.unidade, to_char(p.competencia,'MM/YYYY') comp,
           (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END)::float pool
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE rc.papel = 'levantamento' AND rc.corretor_id = ANY($1::int[])
      AND rc.percentual < $2
    ORDER BY n.id`, [CAPTADORES, NOVA_CAPTACAO])).rows;

  const aplicar = [];
  const fora = [];

  for (const n of negocios) {
    const linhas = (await q(`
      SELECT rc.id, rc.papel, rc.percentual::float pct,
             COALESCE(NULLIF(TRIM(k.nome_comercial),''), k.nome, rc.nome_livre) nome,
             COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                       WHERE fp.negocio_corretor_id = rc.id), 0)::float pago
      FROM fechamento_negocio_corretores rc
      LEFT JOIN corretores k ON k.id = rc.corretor_id
      WHERE rc.negocio_id = $1`, [n.id])).rows;

    const cap = linhas.filter((l) => l.papel === "levantamento");
    const fec = linhas.filter((l) => l.papel === "fechamento");
    const onde = `#${n.id} ${n.comp} ${n.unidade}`;

    if (cap.length !== 1) {
      fora.push(`${onde}: ${cap.length} captadores — ${cap.map((l) => `${l.nome} ${l.pct * 100}%`).join(" + ")}`);
      continue;
    }
    if (fec.length !== 1) {
      fora.push(`${onde}: ${fec.length} fechadores — ${fec.map((l) => `${l.nome} ${l.pct * 100}%`).join(" + ")}`);
      continue;
    }
    const f = fec[0];
    const novoFech = Number((f.pct - DIFERENCA).toFixed(6));
    if (novoFech < 0) {
      fora.push(`${onde}: fechamento em ${f.pct * 100}%, não dá pra tirar 10 pontos`);
      continue;
    }
    // Quem já recebeu não devolve: se o novo devido ficar abaixo do pago, o
    // acerto é manual.
    if (f.pago > novoFech * n.pool + 0.01) {
      fora.push(`${onde}: fechador ${f.nome} já recebeu R$ ${f.pago.toFixed(2)} e passaria a dever R$ ${(novoFech * n.pool).toFixed(2)}`);
      continue;
    }
    aplicar.push({ onde, captador: cap[0], fechador: f, novoFech, nome: cap[0].nome });
  }

  console.log(`negócios com captação deles abaixo de 20%: ${negocios.length}`);
  console.log(`  a corrigir: ${aplicar.length}  ·  fora: ${fora.length}`);
  aplicar.forEach((a) =>
    console.log(`   ${a.onde}: captação ${a.captador.pct * 100}% -> 20% (${a.nome}) · fechamento ${a.fechador.pct * 100}% -> ${a.novoFech * 100}% (${a.fechador.nome})`)
  );
  if (fora.length) {
    console.log("\nficam como estão (sem regra definida ou com comissão já paga):");
    fora.forEach((f) => console.log(`   ${f}`));
  }

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  for (const a of aplicar) {
    await q(`UPDATE fechamento_negocio_corretores SET percentual = $2 WHERE id = $1`, [a.captador.id, NOVA_CAPTACAO]);
    await q(`UPDATE fechamento_negocio_corretores SET percentual = $2 WHERE id = $1`, [a.fechador.id, a.novoFech]);
  }
  console.log(`\ncorrigidos: ${aplicar.length} negócios`);

  const { rows: somas } = await q(`
    WITH s AS (SELECT n.id, n.periodo_id, round(sum(rc.percentual)*100,2)::float soma
               FROM fechamento_negocios n JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
               WHERE NOT n.cancelado GROUP BY n.id)
    SELECT p.tipo, s.soma, count(*)::int negocios
    FROM s JOIN fechamento_periodos p ON p.id = s.periodo_id
    GROUP BY 1,2 ORDER BY 1,2`);
  console.log("\nsoma do rateio depois da correção:");
  console.table(somas);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
