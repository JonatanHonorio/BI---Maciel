// Permite que uma linha de rateio aponte para um nome DIGITADO, e não para um
// corretor do Kurole (19/09/2026 — pedido do Jonatan em 21/09).
//
// Por quê: os fechamentos retroativos de dez/2025 a ago/2026 têm captadores e
// vendedores que não existem mais no cadastro do Kurole. Sem uma saída, esses
// negócios não entram — ou entram com a comissão atribuída à pessoa errada.
//
// É TEMPORÁRIO. Quando a carga retroativa terminar, a tela volta a aceitar só
// nome da lista (basta desligar PERMITE_NOME_LIVRE_NO_RATEIO em
// src/lib/flags.ts). As colunas ficam: linha já gravada com nome digitado
// continua legível, e nada quebra.
//
// Idempotente — seguro rodar de novo.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  // corretor_id deixa de ser obrigatório para dar lugar ao nome digitado.
  await pool.query(`
    ALTER TABLE fechamento_negocio_corretores
    ALTER COLUMN corretor_id DROP NOT NULL
  `);
  console.log("ok: corretor_id agora aceita nulo");

  await pool.query(`
    ALTER TABLE fechamento_negocio_corretores
    ADD COLUMN IF NOT EXISTS nome_livre TEXT
  `);
  console.log("ok: coluna nome_livre");

  // A linha precisa identificar ALGUÉM. Sem esta trava, um rateio poderia
  // ficar com os dois campos vazios e a comissão não teria destinatário —
  // apareceria na tela como "—" e ninguém notaria até o pagamento.
  await pool.query(`
    ALTER TABLE fechamento_negocio_corretores
    DROP CONSTRAINT IF EXISTS fnegcorr_tem_destinatario
  `);
  await pool.query(`
    ALTER TABLE fechamento_negocio_corretores
    ADD CONSTRAINT fnegcorr_tem_destinatario
    CHECK (corretor_id IS NOT NULL OR NULLIF(TRIM(nome_livre), '') IS NOT NULL)
  `);
  console.log("ok: trava de destinatário (corretor do Kurole ou nome digitado)");

  const { rows } = await pool.query(`
    SELECT count(*) FILTER (WHERE corretor_id IS NOT NULL) AS do_kurole,
           count(*) FILTER (WHERE corretor_id IS NULL)     AS digitados
    FROM fechamento_negocio_corretores
  `);
  console.log("linhas de rateio hoje:", rows[0]);

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
