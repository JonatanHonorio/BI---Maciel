#!/usr/bin/env node
/**
 * A captação da ref 64246 (Dutra, venda, 05/2026, CT 336) é da Evelyn, não do
 * Carlos Carvalho — informado pelo Jonatan em 06/10/2026.
 *
 * O negócio tinha o Carlos nos DOIS blocos, Levantamento e Fechamento, que é o
 * padrão de quem capta e fecha o próprio imóvel — foi o que fez o erro passar
 * despercebido. O Fechamento continua dele; só a captação muda de mão.
 *
 * A Evelyn Silva (corretor 80, `adm.dutra@`) é a gerente administrativa da
 * Dutra e já está na lista de quem recebe rateio, como a Secretaria Comercial.
 * ⚠️ Não confundir com KEVELYN KETHULYN SILVA ROSA (1080, `controle.dutra@`),
 * outra pessoa na mesma unidade — a conferência pelo id existe por isso.
 *
 * O percentual não muda: 10% da comissão pela captação, R$ 1.146,00 dos
 * R$ 11.460,00. O negócio continua somando 54,5%.
 *
 * Uso: node scripts/corrige-levantamento-64246.js [--aplicar]
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

const LINHA = 2429;          // fechamento_negocio_corretores.id do Levantamento
const DE = 646;              // CARLOS CARVALHO
const PARA = 80;             // Evelyn Silva

(async () => {
  const [l] = (await q(`
    SELECT rc.id, rc.papel, rc.corretor_id, (rc.percentual*100)::float pct,
           n.id AS negocio, n.ref, n.comissao::float,
           p.unidade, p.tipo, to_char(p.competencia,'MM/YYYY') comp,
           COALESCE((SELECT count(*) FROM fechamento_pagamentos fp
                     WHERE fp.negocio_corretor_id = rc.id), 0)::int baixas
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE rc.id = $1`, [LINHA])).rows;

  if (!l) throw new Error(`a linha ${LINHA} não existe mais`);
  if (l.papel !== "levantamento" || l.ref !== "64246") {
    throw new Error(`a linha ${LINHA} mudou: achei ${l.papel} na ref ${l.ref}`);
  }
  console.log(`ref ${l.ref} · ${l.unidade}/${l.tipo} · ${l.comp} · comissão R$ ${l.comissao}`);
  console.log(`levantamento: ${l.pct}% = R$ ${(l.comissao * l.pct / 100).toFixed(2)}`);

  if (l.corretor_id === PARA) {
    console.log("\njá está com a Evelyn — nada a fazer.");
    await pool.end();
    return;
  }
  if (l.corretor_id !== DE) {
    throw new Error(`esperava o corretor ${DE} nessa linha, achei ${l.corretor_id}`);
  }

  /*
   * Baixa lançada seria outro problema: trocar o destinatário deixaria um
   * pagamento feito a uma pessoa pendurado no nome de outra. Aqui não há
   * nenhuma — a tela mostra "Pendente, R$ 0,00 pago" —, mas a trava fica para
   * o dia em que esse script for usado de molde.
   */
  if (l.baixas > 0) {
    throw new Error(`esta linha tem ${l.baixas} baixa(s) de comissão — acerte o pagamento antes de trocar o destinatário`);
  }

  const { rows: nomes } = await q(`
    SELECT id, COALESCE(NULLIF(TRIM(nome_comercial),''), NULLIF(TRIM(nome),''), email) nome, ativo
    FROM corretores WHERE id = ANY($1::int[])`, [[DE, PARA]]);
  console.log("\nde / para:");
  console.table(nomes);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const r = await q(`
    UPDATE fechamento_negocio_corretores SET corretor_id = $2, nome_livre = NULL
    WHERE id = $1 AND corretor_id = $3`, [LINHA, PARA, DE]);
  console.log(`\nlinhas alteradas: ${r.rowCount}`);

  const { rows: depois } = await q(`
    SELECT rc.papel,
           COALESCE(NULLIF(TRIM(k.nome_comercial),''), NULLIF(TRIM(k.nome),''), rc.nome_livre) nome,
           (rc.percentual*100)::float pct,
           round(rc.percentual * n.comissao, 2)::float devido
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE rc.negocio_id = $1 ORDER BY rc.papel, rc.id`, [l.negocio]);
  console.log("\nrateio depois (venda fecha em 54,5%):");
  console.table(depois);
  console.log("soma:", depois.reduce((s, x) => s + x.pct, 0) + "%");

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
