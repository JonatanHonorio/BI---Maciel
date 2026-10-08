#!/usr/bin/env node
/**
 * O valor da venda da ref 54051 não acompanhou a correção da comissão
 * (08/10/2026).
 *
 * A Tatiane baixou a comissão para R$ 9.000 na tela de correção e avisou: "fiz
 * a alteração mas o valor da venda não mudou, teria que ter mudado para
 * R$ 150.000". Ela está certa — a casa trabalha com 6% fixo, e
 * 9.000 ÷ 6% = 150.000. O valor tinha ficado em R$ 166.666,67, que é a conta
 * da comissão ANTIGA (R$ 10.000).
 *
 * Por que aconteceu: no formulário de LANÇAMENTO o valor é calculado e a adm
 * nem o digita; na tela de CORREÇÃO são dois campos soltos, e mudar um não
 * mexe no outro. O conserto da tela vai junto neste commit — aqui fica só o
 * acerto do registro.
 *
 * De passagem, a referência está gravada como " 54051", com um espaço na
 * frente — foi assim que ela não apareceu numa busca por "54051". O espaço sai
 * também.
 *
 * O rateio não muda: ele é percentual sobre a COMISSÃO, que já estava certa.
 * Nenhuma baixa foi lançada neste negócio, então não há repasse a refazer.
 *
 * Uso: node scripts/corrige-valor-venda-54051.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const NEGOCIO = 906;
const TAXA = 0.06;

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const [n] = (await q(`
    SELECT n.id, n.ref, n.endereco, n.valor::float, n.comissao::float,
           p.unidade, p.tipo, to_char(p.competencia,'MM/YYYY') comp,
           (SELECT count(*)::int FROM fechamento_pagamentos fp
            JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
            WHERE rc.negocio_id = n.id) baixas
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = $1`, [NEGOCIO])).rows;

  if (!n) throw new Error(`negócio ${NEGOCIO} não existe`);
  if (n.tipo !== "venda") throw new Error("este acerto é de venda — a regra dos 6% não vale em locação");

  const certo = Math.round((n.comissao / TAXA) * 100) / 100;
  console.log(`ref [${n.ref}] · ${n.unidade} · ${n.comp}`);
  console.log(`${n.endereco}`);
  console.log(`comissão R$ ${n.comissao.toFixed(2)} · valor hoje R$ ${n.valor.toFixed(2)} · pela regra R$ ${certo.toFixed(2)}`);
  console.log(`baixas de comissão lançadas: ${n.baixas}`);
  console.log(`referência com espaço sobrando: ${n.ref !== n.ref.trim() ? "sim" : "não"}`);

  if (Math.abs(n.valor - certo) < 0.01 && n.ref === n.ref.trim()) {
    console.log("\njá está certo — nada a fazer.");
    await pool.end();
    return;
  }

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  await q(`
    UPDATE fechamento_negocios SET valor = $2, ref = btrim(ref), atualizado_em = NOW()
    WHERE id = $1`, [NEGOCIO, certo]);

  const [d] = (await q(`
    SELECT ref, valor::float, comissao::float FROM fechamento_negocios WHERE id = $1`, [NEGOCIO])).rows;
  console.log(`\ngravado: ref [${d.ref}] · valor R$ ${d.valor.toFixed(2)} · comissão R$ ${d.comissao.toFixed(2)}`);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
