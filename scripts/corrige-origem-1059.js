#!/usr/bin/env node
/**
 * Negócio #1059 (ref 65228, venda Aquarius out/2026) estava com origem
 * "Instagram". O Jonatan avisou em 03/11/2026 que a venda veio de tráfego
 * pago — a adm pôs Instagram porque "Tráfego Pago" ainda não existia na
 * lista de origens. Idempotente: só mexe se ainda estiver em "Instagram".
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });

(async () => {
  const { rows: antes } = await pool.query(
    `SELECT id, ref, origem FROM fechamento_negocios WHERE id = 1059`
  );
  console.log("antes:", JSON.stringify(antes[0]));
  if (!antes.length) throw new Error("negócio 1059 não encontrado");
  if (antes[0].origem !== "Instagram") {
    console.log("nada a fazer — origem já não é Instagram");
    await pool.end();
    return;
  }
  const { rows: depois } = await pool.query(
    `UPDATE fechamento_negocios SET origem = 'Tráfego Pago', atualizado_em = NOW()
     WHERE id = 1059 AND origem = 'Instagram' RETURNING id, ref, origem`
  );
  console.log("depois:", JSON.stringify(depois[0]));
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
