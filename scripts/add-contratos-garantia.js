// Garantia locatícia no Kanban de contratos (26/09/2026).
// Idempotente — seguro rodar de novo.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * Pedido da Ana em 26/09: em locação o contrato precisa dizer COMO a locação
   * está garantida — caução, seguro fiança, fiador. É campo do contrato de
   * locação e não existe em venda, por isso fica nulo lá em vez de virar mais
   * um item dentro de `pagamento`, que é texto livre e não dá para filtrar.
   *
   * `garantia_detalhe` guarda o que varia conforme o tipo: valor da caução,
   * seguradora e apólice, nome do fiador.
   */
  await pool.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS garantia VARCHAR(40)`);
  await pool.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS garantia_detalhe TEXT`);
  console.log("ok: contratos.garantia + garantia_detalhe");

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
