#!/usr/bin/env node
/**
 * Uniformiza o NOME DIGITADO nas linhas de rateio do fechamento (28/09/2026).
 *
 * Por que existe: enquanto `PERMITE_NOME_LIVRE_NO_RATEIO` está ligada, a adm
 * pode digitar o nome de quem não está mais no cadastro do Kurole. Digitação
 * livre gera grafia livre — a Fabiana Oliveira aparece de quatro jeitos, e um
 * ranking por nome a transformaria em quatro pessoas.
 *
 * Confirmado pelo Jonatan em 28/09/2026: são erros de digitação, todos da
 * mesma pessoa. Quando a carga retroativa terminar e o nome voltar a sair da
 * lista, o problema deixa de existir — por isso isto é um script de correção,
 * e não uma regra no código.
 *
 * Como a grafia certa foi escolhida:
 *  - quem está no cadastro do Kurole manda (Fabiana Oliveira 347, SIRLEY
 *    ALMEIDA 853, TIAGO LUCAS 876 — daí "Tiago" sem H, ao contrário do que o
 *    volume sugeria);
 *  - quem não está, vale a grafia repetida mais vezes.
 *
 * NÃO liga a linha ao corretor cadastrado: isso muda quem recebe a comissão e
 * é decisão à parte. Aqui só o texto muda.
 *
 * Uso: node scripts/corrigir-grafia-rateio.js [--aplicar]
 * Sem --aplicar, apenas mostra o que faria. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APLICAR = process.argv.includes("--aplicar");

// errado -> certo. A comparação é exata (depois de TRIM), para não arrastar
// junto um homônimo parecido: "Thiago Silva", "Jean Silva" e "Kely Silva" são
// pessoas diferentes e ficam de fora.
const CORRECOES = [
  ["Fabiana oliveira", "Fabiana Oliveira"],
  ["Fabiana Oliveiora", "Fabiana Oliveira"],
  ["Fabian Oliveiar", "Fabiana Oliveira"],
  ["omerciaFabiana Oliveira", "Fabiana Oliveira"], // sobra de um copiar/colar
  ["sirley", "Sirley"],
  ["Siley", "Sirley"],
  ["Karina Katie", "Karine Katie"],
  ["Gabriele Silva", "Gabriela Silva"],
  ["Thiago Lucas", "Tiago Lucas"], // cadastro: TIAGO LUCAS (id 876)
  ["Diego guimaraes", "Diego Guimarães"],

  // Segunda rodada, mesma conversa de 28/09/2026. Aqui NÃO se liga ninguém ao
  // cadastro: o Jonatan avisou que todas essas pessoas já saíram da empresa,
  // então o nome digitado continua sendo o destinatário — só a grafia se
  // uniformiza, para o ranking não contar a mesma pessoa duas vezes.
  //
  // "o Mateus é a mesma pessoa sim": as três grafias são do #857 Matheus Yan
  // Vieira Ferraro (todas da Satélite), uma trazendo o Vieira, outra o
  // Ferraro e a terceira só o primeiro nome. Fica o nome do cadastro, que é o
  // único que contém os dois sobrenomes sem eu inventar uma forma.
  ["Mateus", "Matheus Yan Vieira Ferraro"],
  ["Matheus Vieira", "Matheus Yan Vieira Ferraro"],
  ["Matheus Ferraro", "Matheus Yan Vieira Ferraro"],
  // O Jonatan reconheceu os dois em 28/09/2026: o "Davi" da Esplanada é o
  // David Borges (que continua ATIVO no Kurole, por isso este é o único da
  // segunda rodada que também é religado ao cadastro), e o "Carlos Alberto" da
  // Dutra é o mesmo Carlos Alberto Carvalho do mês seguinte.
  ["davi", "David Borges"],
  ["Davi", "David Borges"],
  ["Carlos Alberto", "Carlos Alberto Carvalho"],
  ["Crhistian", "Christian"], // transposição do H
  // Digitação cortada no meio, e a única outra grafia com "Ricard" na mesma
  // unidade (Vista Verde) é o Ricardo Tokio. É o palpite mais provável, não
  // uma certeza — se estiver errado, é uma linha só para desfazer.
  ["ricard", "Ricardo Tokio"],
];

(async () => {
  let total = 0;
  for (const [errado, certo] of CORRECOES) {
    const { rows } = await pool.query(
      `SELECT rc.id, rc.papel, p.unidade, to_char(p.competencia,'MM/YYYY') comp, n.id neg
       FROM fechamento_negocio_corretores rc
       JOIN fechamento_negocios n ON n.id = rc.negocio_id
       JOIN fechamento_periodos p ON p.id = n.periodo_id
       WHERE rc.corretor_id IS NULL AND TRIM(rc.nome_livre) = $1
       ORDER BY p.competencia, n.id`,
      [errado]
    );
    if (!rows.length) continue;
    total += rows.length;
    console.log(`"${errado}" -> "${certo}"  (${rows.length} linha${rows.length > 1 ? "s" : ""})`);
    rows.forEach((r) => console.log(`    #${r.neg} ${r.unidade} ${r.comp} · ${r.papel}`));

    if (APLICAR) {
      // O WHERE repete a condição: se alguém corrigiu na tela no meio do
      // caminho, a linha já não casa e fica como está.
      await pool.query(
        `UPDATE fechamento_negocio_corretores SET nome_livre = $2
         WHERE corretor_id IS NULL AND TRIM(nome_livre) = $1`,
        [errado, certo]
      );
    }
  }

  console.log(`\n${APLICAR ? "corrigidas" : "a corrigir"}: ${total} linhas`);
  if (!APLICAR) console.log("(simulação — rode com --aplicar para gravar)");

  const { rows: sobra } = await pool.query(
    `SELECT count(DISTINCT TRIM(nome_livre))::int nomes, count(*)::int linhas
     FROM fechamento_negocio_corretores rc
     JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
     WHERE rc.corretor_id IS NULL
       AND rc.papel IN ('levantamento','fechamento','gerencia','lancamento')`
  );
  console.log(`nomes digitados distintos agora: ${sobra[0].nomes} (${sobra[0].linhas} linhas)`);

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
