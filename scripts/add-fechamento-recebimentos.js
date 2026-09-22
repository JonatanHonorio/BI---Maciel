// Recebimento: a parcela da comissão que a imobiliária recebeu, e que o
// sistema distribui sozinho entre os destinatários do rateio.
//
// Pedido da Tatiane (CFO) em 22/09/2026: uma comissão de R$20.000 em 3 parcelas
// de R$6.666,66 obrigava a adm a pegar cada parcela, multiplicar por 3%, 1%,
// 30%... e lançar seis baixas à mão — por parcela, por negócio. Agora ela
// informa valor e data uma vez, e o rateio é aplicado.
//
// Por que uma TABELA e não só as baixas soltas: sem o agrupamento não dá pra
// dizer "recebemos 2 das 3 parcelas", nem desfazer uma parcela lançada errada
// sem caçar seis linhas de pagamento uma a uma.
//
// Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fechamento_recebimentos (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER NOT NULL REFERENCES fechamento_negocios(id) ON DELETE CASCADE,
      valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
      data_recebimento DATE NOT NULL,
      observacao TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      criado_por INTEGER
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recebimentos_negocio ON fechamento_recebimentos (negocio_id)`);

  // A baixa individual continua existindo (correção de centavo, pagamento
  // adiantado a uma pessoa só). Quando vier de um recebimento, aponta pra ele
  // — e o ON DELETE CASCADE desfaz a parcela inteira de uma vez.
  await pool.query(`
    ALTER TABLE fechamento_pagamentos
    ADD COLUMN IF NOT EXISTS recebimento_id INTEGER
      REFERENCES fechamento_recebimentos(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pagamentos_recebimento ON fechamento_pagamentos (recebimento_id)`);

  console.log("ok — fechamento_recebimentos e o vínculo com os pagamentos");
  await pool.end();
})();
