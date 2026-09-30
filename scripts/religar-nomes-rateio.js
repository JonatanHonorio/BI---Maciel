#!/usr/bin/env node
/**
 * Liga ao CORRETOR CADASTRADO as linhas de rateio que tinham só o nome
 * digitado (28/09/2026, autorizado pelo Jonatan: "esses nomes são deles
 * mesmo").
 *
 * Por que essas linhas existem: a lista da tela só mostra corretor ATIVO no
 * Kurole. Quem saiu da empresa sumiu da lista, e a adm digitou o nome à mão
 * para conseguir lançar o fechamento retroativo. O cadastro, porém, continua
 * lá — é o mesmo id que o Kurole usa.
 *
 * Por que importa: linha com `corretor_id` nulo não entra em nenhum ranking
 * nem em nenhuma soma por pessoa. Religando, 296 das 330 linhas soltas voltam
 * a apontar para gente de verdade.
 *
 * Cada par nome→id foi conferido um a um: o nome bate exatamente com o
 * cadastro (só a Sirley é por nome parcial — "SIRLEY ALMEIDA" é a única
 * Sirley do cadastro, e está ativa).
 *
 * `nome_livre` é zerado junto: a constraint `fnegcorr_tem_destinatario` só
 * exige UM dos dois, e `normalizaLinhaRateio` já trata o corretor como o que
 * manda quando os dois vêm preenchidos — deixar o texto para trás só criaria
 * duas versões do mesmo nome.
 *
 * Uso: node scripts/religar-nomes-rateio.js [--aplicar]
 * Sem --aplicar, só mostra o que faria. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APLICAR = process.argv.includes("--aplicar");

// nome digitado -> id do corretor no Kurole
const LIGACOES = [
  ["Fabiana Oliveira", 347],
  ["Sirley", 853], // cadastro: SIRLEY ALMEIDA (ativa)
  ["Luciana Jesus", 358],
  ["Heitor Barbosa", 175],
  ["Alvaro Xavier", 104],
  ["Jandir Pagangrizo", 422],
  // Entrou em 28/09/2026, depois de o Jonatan identificar o "Davi" da
  // Esplanada. É a exceção da regra "não religar": os outros nomes soltos são
  // de gente que saiu da empresa, e o David Borges continua ativo.
  ["David Borges", 565],
];

(async () => {
  let total = 0;
  for (const [nome, id] of LIGACOES) {
    const [cad] = (await pool.query(
      `SELECT id, COALESCE(NULLIF(TRIM(nome_comercial),''),nome) nome, ativo FROM corretores WHERE id = $1`,
      [id]
    )).rows;
    if (!cad) { console.log(`!! corretor ${id} não existe — "${nome}" fica como está`); continue; }

    const { rows } = await pool.query(
      `SELECT rc.papel, count(*)::int linhas
       FROM fechamento_negocio_corretores rc
       WHERE rc.corretor_id IS NULL AND TRIM(rc.nome_livre) = $1
         AND rc.papel IN ('levantamento','fechamento','gerencia','lancamento')
       GROUP BY 1 ORDER BY 1`,
      [nome]
    );
    const n = rows.reduce((s, r) => s + r.linhas, 0);
    if (!n) continue;
    total += n;
    console.log(`"${nome}" -> #${cad.id} ${cad.nome}${cad.ativo ? "" : " (inativo no Kurole)"} · ${n} linhas`);
    rows.forEach((r) => console.log(`    ${r.papel}: ${r.linhas}`));

    if (APLICAR) {
      await pool.query(
        `UPDATE fechamento_negocio_corretores
         SET corretor_id = $2, nome_livre = NULL
         WHERE corretor_id IS NULL AND TRIM(nome_livre) = $1
           AND papel IN ('levantamento','fechamento','gerencia','lancamento')`,
        [nome, id]
      );
    }
  }

  console.log(`\n${APLICAR ? "religadas" : "a religar"}: ${total} linhas`);
  if (!APLICAR) console.log("(simulação — rode com --aplicar para gravar)");

  const [s] = (await pool.query(
    `SELECT count(*) FILTER (WHERE rc.corretor_id IS NOT NULL)::int cadastrado,
            count(*) FILTER (WHERE rc.corretor_id IS NULL)::int digitado,
            count(DISTINCT TRIM(rc.nome_livre))::int nomes
     FROM fechamento_negocio_corretores rc
     JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
     WHERE rc.papel IN ('levantamento','fechamento','gerencia','lancamento')`
  )).rows;
  console.log(`linhas de pessoa agora: ${s.cadastrado} no cadastro · ${s.digitado} digitadas (${s.nomes} nomes)`);

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
