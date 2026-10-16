#!/usr/bin/env node
/**
 * Corrige duas datas digitadas com o ano errado (16/10/2026).
 *
 *   #504  22/12/0005    -> 22/12/2025   (negócio 881, ref 60647, Diretoria, comp 12/2025)
 *   #192  24/06/275760  -> 24/06/2026   (negócio 666, ref 46096, Esplanada, comp 02/2026)
 *
 * As datas certas vieram do Jonatan em 16/10/2026, depois de conferir com quem
 * lançou. Cada recebimento arrasta **5 baixas** com a mesma data errada, ligadas
 * por `recebimento_id` — elas vão junto, senão o negócio fica com o dinheiro
 * entrando numa data e saindo em outra, mil anos depois.
 *
 * NÃO mexe em valor nenhum: só no campo de data. O rateio, os totais e o status
 * de pagamento continuam exatamente iguais — o que muda é a parcela voltar a
 * aparecer nos relatórios por período, de onde ela sumia (R$ 7.267,05 somados).
 *
 * Uso: node scripts/corrige-datas-digitadas.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: roda duas vezes sem efeito.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

const CORRECOES = [
  { recebimento: 504, de: "0005-12-22", para: "2025-12-22" },
  { recebimento: 192, de: "+275760-06-24", para: "2026-06-24" },
];

const q = async (sql, params) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 5) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const br = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const backup = [];

  for (const c of CORRECOES) {
    const [r] = (await q(`
      SELECT r.id, r.valor::float, r.data_recebimento, r.negocio_id,
             n.ref, p.unidade, to_char(p.competencia,'MM/YYYY') comp
      FROM fechamento_recebimentos r
      JOIN fechamento_negocios n ON n.id = r.negocio_id
      JOIN fechamento_periodos p ON p.id = n.periodo_id
      WHERE r.id = $1`, [c.recebimento])).rows;
    if (!r) throw new Error(`recebimento ${c.recebimento} não existe`);

    const { rows: baixas } = await q(`
      SELECT id, valor::float, data_pagamento FROM fechamento_pagamentos
      WHERE recebimento_id = $1 ORDER BY id`, [c.recebimento]);

    const ano = new Date(r.data_recebimento).getFullYear();
    const jaCerto = ano === Number(c.para.slice(0, 4));

    console.log(`\n#${r.id} · ref ${r.ref} · ${r.unidade} · comp ${r.comp} · R$ ${br(r.valor)}`);
    console.log(`  data atual: ${String(r.data_recebimento).slice(0, 24)}`);
    console.log(`  data certa: ${c.para}`);
    console.log(`  baixas ligadas: ${baixas.length} (R$ ${br(baixas.reduce((s, b) => s + b.valor, 0))})`);
    if (jaCerto) { console.log("  → já está corrigido, nada a fazer"); continue; }

    backup.push({ recebimento: r, baixas });

    if (APLICAR) {
      await q(`UPDATE fechamento_recebimentos SET data_recebimento = $2 WHERE id = $1`, [c.recebimento, c.para]);
      const up = await q(`UPDATE fechamento_pagamentos SET data_pagamento = $2 WHERE recebimento_id = $1`, [c.recebimento, c.para]);
      console.log(`  ✔ recebimento e ${up.rowCount} baixa(s) atualizados para ${c.para}`);
    }
  }

  if (backup.length && APLICAR) {
    const arq = `scripts/backup-datas-${Date.now()}.json`;
    fs.writeFileSync(arq, JSON.stringify(backup, null, 2));
    console.log(`\nbackup do estado anterior: ${arq}`);
  }

  // Confere que não sobrou nenhuma data fora da faixa plausível.
  const [{ rec }] = (await q(`
    SELECT count(*)::int rec FROM fechamento_recebimentos
    WHERE data_recebimento < DATE '2000-01-01' OR data_recebimento > DATE '2100-12-31'`)).rows;
  const [{ pag }] = (await q(`
    SELECT count(*)::int pag FROM fechamento_pagamentos
    WHERE data_pagamento < DATE '2000-01-01' OR data_pagamento > DATE '2100-12-31'`)).rows;
  console.log(`\nrestam com data impossível → recebimentos: ${rec} · baixas: ${pag}`);
  if (!APLICAR) console.log("\n(simulação — rode com --aplicar para gravar)");
  await pool.end();
})();
