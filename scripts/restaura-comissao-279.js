#!/usr/bin/env node
/**
 * Devolve a comissão do negócio 279 (ref 53513, Urbanova, comp 04/2026), que
 * ficou NULA em 16/10/2026.
 *
 * O QUE ACONTECEU. A Rachel pediu três correções de comissão. A Tatiane fez as
 * três; as duas primeiras gravaram certo:
 *
 *   id 325  ref 63470  valor 233.333,33  comissão 14.000,00   (14.000 ÷ 6%)
 *   id 122  ref 2949   valor 437.300,00  comissão 26.238,00   (26.238 ÷ 6%)
 *   id 279  ref 53513  valor 261.866,67  comissão **NULA**
 *
 * Na terceira a comissão sumiu: ao apagar o campo para redigitar e salvar pelo
 * campo de valor, a tela mandava `comissao: null` e a rota gravava. Corrigido
 * no mesmo dia (a tela omite campo em branco; a rota recusa pool nulo).
 *
 * QUAL É O NÚMERO CERTO. A Tatiane confirmou que o valor de venda está certo.
 * Pela regra da casa (valor = comissão ÷ 6%), 261.866,67 × 6% = **15.712,00** —
 * e 15.712 ÷ 6% devolve exatamente 261.866,67. É o mesmo padrão das outras duas
 * correções do dia, o que fecha a conta.
 *
 * É SEGURO. O negócio não tem nenhuma baixa nem nenhum recebimento lançado:
 * ninguém recebeu nada em cima do número errado. O rateio é percentual, então
 * os seis destinatários voltam a ter o devido calculado sozinho.
 *
 * Uso: node scripts/restaura-comissao-279.js [--aplicar]
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const NEGOCIO = 279;
const REF = "53513";
const COMISSAO = 15712.0;
const TAXA = 0.06;

const q = async (sql, params) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 5) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const br = (n) => (n == null ? "— (nulo)" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

(async () => {
  const [n] = (await q(`
    SELECT n.id, n.ref, n.valor::float valor, n.comissao::float comissao, n.endereco,
           p.unidade, p.tipo, p.status, to_char(p.competencia,'MM/YYYY') comp,
           (SELECT count(*)::int FROM fechamento_recebimentos r WHERE r.negocio_id = n.id) recebimentos,
           (SELECT COALESCE(sum(fp.valor),0)::float FROM fechamento_pagamentos fp
             JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
            WHERE rc.negocio_id = n.id) pago
    FROM fechamento_negocios n JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE n.id = $1`, [NEGOCIO])).rows;
  if (!n) throw new Error(`negócio ${NEGOCIO} não existe`);
  if (n.ref !== REF) throw new Error(`esperava a ref ${REF}, achei ${n.ref}`);

  console.log(`negócio ${n.id} · ref ${n.ref} · ${n.unidade} ${n.comp} (${n.status})`);
  console.log(`${n.endereco}`);
  console.log(`\nvalor:    R$ ${br(n.valor)}`);
  console.log(`comissão: R$ ${br(n.comissao)}   →   R$ ${br(COMISSAO)}`);
  console.log(`conferência: ${br(COMISSAO)} ÷ 6% = R$ ${br(COMISSAO / TAXA)} (valor gravado: R$ ${br(n.valor)})`);
  console.log(`recebimentos lançados: ${n.recebimentos} · já pago aos destinatários: R$ ${br(n.pago)}`);

  if (Math.abs(Number(n.valor) - COMISSAO / TAXA) > 0.01) {
    throw new Error("o valor gravado não bate com a comissão proposta — confirmar antes de aplicar");
  }
  if (n.recebimentos > 0 || n.pago > 0.01) {
    throw new Error("este negócio passou a ter baixa ou recebimento — a correção precisa ser combinada antes");
  }
  if (n.comissao != null) { console.log("\njá está preenchida — nada a fazer."); await pool.end(); return; }

  const { rows: rateio } = await q(`
    SELECT rc.papel, rc.percentual::float pct, COALESCE(c.nome_comercial, c.nome, rc.nome_livre) quem
    FROM fechamento_negocio_corretores rc LEFT JOIN corretores c ON c.id = rc.corretor_id
    WHERE rc.negocio_id = $1 ORDER BY rc.papel, rc.id`, [NEGOCIO]);
  console.log(`\ncom a comissão de volta, o devido de cada um:`);
  let soma = 0;
  for (const r of rateio) {
    const v = COMISSAO * r.pct;
    soma += v;
    console.log(`  ${String(r.papel).padEnd(16)} ${(r.pct * 100).toFixed(1).padStart(5)}%  R$ ${br(v).padStart(10)}  ${r.quem || "?"}`);
  }
  console.log(`  ${"".padEnd(16)} ${"".padStart(5)}   R$ ${br(soma).padStart(10)}  distribuído · R$ ${br(COMISSAO - soma)} fica com a imobiliária`);

  if (!APLICAR) { console.log("\n(simulação — rode com --aplicar para gravar)"); await pool.end(); return; }

  await q(`UPDATE fechamento_negocios SET comissao = $2, atualizado_em = NOW() WHERE id = $1`, [NEGOCIO, COMISSAO]);
  const [dep] = (await q(`SELECT comissao::float c FROM fechamento_negocios WHERE id = $1`, [NEGOCIO])).rows;
  console.log(`\n✔ gravado: comissão agora é R$ ${br(dep.c)}`);
  await pool.end();
})();
