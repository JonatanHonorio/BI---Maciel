#!/usr/bin/env node
/**
 * Corretores que recebem rateio no fechamento mas NÃO existem no cadastro do
 * Kurole.
 *
 * Por que existem: gente que vende ou aluga de vez em quando sem estar na
 * folha do Kurole. Enquanto a digitação livre de nome estava ligada, a adm
 * escrevia o nome e seguia; desde 30/09/2026 o rateio só aceita corretor da
 * lista, então eles precisam de um cadastro aqui.
 *
 * Os ids ficam na faixa dos **900000**, bem fora da do Kurole (hoje -1012 a
 * 1069). O import do KSI faz upsert por id e nunca apaga linha que não veio no
 * dump, então um id que o Kurole jamais vai gerar sobrevive a todos os
 * imports sem risco de alguém de lá sobrescrever o cadastro.
 *
 * ⚠️ Aparecer na tela do rateio exige as DUAS pontas: a linha em `corretores`
 * (por causa da FK de `fechamento_negocio_corretores.corretor_id`) e a entrada
 * em `scripts/corretores_fechamento.json`, que é a lista curada que o
 * formulário usa — ela não mostra todos os corretores ativos. Este script faz
 * a primeira; a segunda é editada à mão, no mesmo commit.
 *
 * Se a pessoa for cadastrada no Kurole um dia, o certo é migrar o rateio dela
 * para o id de lá e desativar este cadastro — dois ids para a mesma pessoa
 * partiriam o ranking em dois.
 *
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });

const EXTERNOS = [
  {
    id: 900001,
    nome: "Zulietti",
    obs: "01/10/2026 — participa dos lançamentos; com ele no bloco Lançamento a gerência cai de 10% para 5%",
  },
  {
    id: 900002,
    nome: "ANA MARIA MOSTI",
    obs: "01/10/2026 — vendas e locações esporádicas; pedida desde 18/09 (a única Mosti do Kurole é a Micaele, id 920, que é outra pessoa)",
  },
];

(async () => {
  for (const c of EXTERNOS) {
    await pool.query(
      `INSERT INTO corretores (id, nome, nome_comercial, ativo, empresa)
       VALUES ($1, $2, $2, 1, 1)
       ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome,
         nome_comercial = EXCLUDED.nome_comercial, ativo = 1`,
      [c.id, c.nome]
    );
    console.log(`ok: #${c.id} ${c.nome}`);
  }

  const { rows } = await pool.query(
    `SELECT id, nome_comercial, ativo FROM corretores WHERE id = ANY($1::int[]) ORDER BY id`,
    [EXTERNOS.map((c) => c.id)]
  );
  console.table(rows);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
