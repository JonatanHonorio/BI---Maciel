#!/usr/bin/env node
/**
 * Os 4 negócios que ainda estavam gravados com origem "V4" passam a
 * "Tráfego Pago".
 *
 * Por quê: a V4 era a agência, não o canal. Ela saiu da lista de origens em
 * 03/11/2026 porque a Maciel não a usa mais, e deixar os 4 para trás faria a
 * mesma venda de anúncio aparecer com dois rótulos em qualquer relatório que
 * olhe a série inteira. O Jonatan autorizou a conversão em 03/11/2026.
 *
 * Todos os 4 estão em períodos JÁ ENVIADOS. Origem não entra em nenhuma
 * conta de dinheiro — valor, comissão e rateio não são tocados.
 *
 * Idempotente: só converte o que ainda estiver em "V4". Grava backup JSON
 * antes de escrever.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DE = "V4";
const PARA = "Tráfego Pago";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });

(async () => {
  const { rows: antes } = await pool.query(
    `SELECT n.id, n.ref, n.origem, to_char(n.data_contrato,'DD/MM/YYYY') AS data_contrato,
            n.valor, p.unidade, p.tipo, to_char(p.competencia,'YYYY-MM') AS competencia, p.status
     FROM fechamento_negocios n JOIN fechamento_periodos p ON p.id = n.periodo_id
     WHERE n.origem = $1 ORDER BY p.competencia, n.id`,
    [DE]
  );

  if (!antes.length) {
    console.log(`nada a fazer — nenhum negócio com origem "${DE}"`);
    await pool.end();
    return;
  }

  const backup = path.join(__dirname, `backup-origem-v4-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(antes, null, 2), "utf-8");
  console.log(`backup: ${backup}`);

  console.log(`\n${antes.length} negócio(s) a converter:`);
  for (const r of antes) {
    console.log(`  #${r.id} ${r.data_contrato} ${r.competencia} ${r.unidade}/${r.tipo} ` +
      `[${r.status}] ref ${r.ref} R$ ${Number(r.valor).toLocaleString("pt-BR")}`);
  }

  const { rows: depois } = await pool.query(
    `UPDATE fechamento_negocios SET origem = $2, atualizado_em = NOW()
     WHERE origem = $1 RETURNING id, ref, origem`,
    [DE, PARA]
  );
  console.log(`\nconvertidos: ${depois.length}`);
  for (const r of depois) console.log(`  #${r.id} ref ${r.ref} -> ${r.origem}`);

  const { rows: sobrou } = await pool.query(
    `SELECT count(*)::int AS n FROM fechamento_negocios WHERE origem = $1`, [DE]
  );
  console.log(`\nainda em "${DE}": ${sobrou[0].n}`);

  const { rows: tp } = await pool.query(
    `SELECT count(*)::int AS n FROM fechamento_negocios WHERE origem = $1`, [PARA]
  );
  console.log(`total em "${PARA}": ${tp[0].n}`);
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
