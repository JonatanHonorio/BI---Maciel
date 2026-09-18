// Acrescenta usuarios_bi.unidades — lista de unidades de quem cobre mais de
// uma (a gerente administrativa da Urbanova cobre Urbanova + Diretoria +
// Lançamento). 18/09/2026. Idempotente (ADD COLUMN IF NOT EXISTS), seguro de
// rodar com o código antigo no ar: coluna nullable, sem default.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE usuarios_bi ADD COLUMN IF NOT EXISTS unidades TEXT[]`);
  console.log("ok: usuarios_bi.unidades");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
