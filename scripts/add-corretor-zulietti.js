#!/usr/bin/env node
/**
 * Cria o Zulietti no cadastro de corretores do BI (01/10/2026).
 *
 * Por que existe: ele participa dos lançamentos e precisa receber rateio, mas
 * NÃO tem cadastro no Kurole — e a digitação livre de nome no rateio foi
 * fechada em 30/09, então a Mayra não conseguia lançar a venda dele.
 *
 * O id é **900001**, bem fora da faixa do Kurole (hoje vai de -1012 a 1069).
 * Isso é de propósito: o import do KSI faz upsert por id
 * (`INSERT ... ON CONFLICT (id) DO UPDATE`) e nunca apaga linha que não veio
 * no dump, então um id que o Kurole jamais vai gerar sobrevive a todos os
 * imports sem risco de alguém de lá sobrescrever este cadastro.
 *
 * Aparecer na lista do rateio depende de DUAS coisas: existir aqui (por causa
 * da FK de `fechamento_negocio_corretores.corretor_id`) e estar em
 * `scripts/corretores_fechamento.json`, que é a lista curada que a tela usa —
 * ela não mostra todos os corretores ativos. Este script cuida da primeira; a
 * segunda já foi feita no mesmo commit.
 *
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });

const ID = 900001;
const NOME = "Zulietti";

(async () => {
  await pool.query(
    `INSERT INTO corretores (id, nome, nome_comercial, ativo, empresa)
     VALUES ($1, $2, $2, 1, 1)
     ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome,
       nome_comercial = EXCLUDED.nome_comercial, ativo = 1`,
    [ID, NOME]
  );

  const { rows } = await pool.query(
    `SELECT id, nome, nome_comercial, ativo FROM corretores WHERE id = $1`, [ID]
  );
  console.table(rows);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
