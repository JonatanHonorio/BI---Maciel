// Senha de atendimento do Kanban de contratos (26/09/2026).
// Idempotente — seguro rodar de novo.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * Senha em ordem de chegada, como a fila do balcão: a Ana cria o card e ele
   * recebe o próximo número. É o que responde ao gerente "está chegando a
   * minha vez?" sem ele precisar ver o contrato das outras unidades.
   *
   * Sequência própria, e não MAX(senha)+1: dois cards criados no mesmo
   * instante pegariam o mesmo número com o MAX, e senha repetida na fila é
   * exatamente o que não pode acontecer.
   *
   * Continua crescendo, sem zerar por dia ou por mês: contrato leva semanas,
   * e zerar faria dois cards vivos carregarem a mesma senha.
   */
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS contratos_senha_seq`);
  await pool.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS senha INTEGER`);
  await pool.query(`
    ALTER TABLE contratos
    ALTER COLUMN senha SET DEFAULT nextval('contratos_senha_seq')
  `);

  // Cards que já existiam ganham senha pela ordem em que foram criados.
  const { rows } = await pool.query(`SELECT id FROM contratos WHERE senha IS NULL ORDER BY criado_em, id`);
  for (const r of rows) {
    await pool.query(`UPDATE contratos SET senha = nextval('contratos_senha_seq') WHERE id = $1`, [r.id]);
  }
  if (rows.length) console.log(`ok: ${rows.length} card(s) antigos numerados`);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS contratos_senha_idx ON contratos (senha)`);
  console.log("ok: contratos.senha + sequência + índice único");

  const [{ n, ultima }] = (await pool.query(
    `SELECT count(*)::int n, coalesce(max(senha), 0)::int ultima FROM contratos`
  )).rows;
  console.log(`cards: ${n} · última senha: ${ultima}`);

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
