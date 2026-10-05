#!/usr/bin/env node
/**
 * Pedidos da Ana Mendes no quadro de contratos (05/10/2026).
 *
 * 1. A fase "Enviado para assinatura" vira DUAS: **Enviar para assinatura**
 *    (o gerente aprovou, falta a Ana mandar) e **Aguardando assinatura** (já
 *    foi, espera-se o cliente). Com uma fase só não dava pra separar o que é
 *    trabalho dela do que é espera de terceiro.
 *
 *    Como a fase é um número, "Assinado e finalizado" sai de 7 e vai pra 8 —
 *    e o histórico vai junto, senão um evento antigo passaria a dizer que o
 *    contrato foi para "Aguardando assinatura" quando foi para "Finalizado".
 *    Os cards que hoje estão na 6 FICAM na 6 ("Enviar para assinatura"):
 *    decisão do Jonatan, porque nenhum deles chegou a ser enviado.
 *
 * 2. Número do contrato no card, ao lado da referência — coluna nova.
 *
 * 3. A Ana precisa ser avisada quando o gerente confere e move o card. Tabela
 *    de notificações, lida pelo sino do BI; o e-mail sai pelo mesmo caminho do
 *    aviso que o gerente já recebe.
 *
 * Uso: node scripts/contratos-assinatura-e-avisos.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const [{ tem_coluna }] = (await q(`
    SELECT count(*)::int tem_coluna FROM information_schema.columns
    WHERE table_name = 'contratos' AND column_name = 'contrato'`)).rows;
  const [{ tem_tabela }] = (await q(`
    SELECT count(*)::int tem_tabela FROM information_schema.tables
    WHERE table_name = 'contrato_notificacoes'`)).rows;

  const { rows: antes } = await q(`
    SELECT fase, count(*)::int cards FROM contratos GROUP BY fase ORDER BY fase`);
  const [{ eventos7 }] = (await q(`
    SELECT count(*)::int eventos7 FROM contrato_eventos WHERE de = 7 OR para = 7`)).rows;
  const [{ cards7 }] = (await q(`SELECT count(*)::int cards7 FROM contratos WHERE fase = 7`)).rows;

  console.log(`coluna contratos.contrato: ${tem_coluna ? "já existe" : "a criar"}`);
  console.log(`tabela contrato_notificacoes: ${tem_tabela ? "já existe" : "a criar"}`);
  console.log(`cards na fase 7 (Finalizado) a renumerar para 8: ${cards7}`);
  console.log(`eventos de histórico citando a fase 7: ${eventos7}`);
  console.log("\ncards por fase hoje:");
  console.table(antes);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  await q(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS contrato VARCHAR(30)`);
  console.log("\ncoluna contratos.contrato pronta");

  /*
   * A renumeração roda uma vez só. Rodar duas vezes levaria "Finalizado" para
   * 9, que não existe — por isso a guarda pelo estado em vez de um UPDATE solto.
   */
  if (cards7 > 0 || eventos7 > 0) {
    const a = await q(`UPDATE contratos SET fase = 8 WHERE fase = 7`);
    const b = await q(`UPDATE contrato_eventos SET para = 8 WHERE para = 7`);
    const c = await q(`UPDATE contrato_eventos SET de = 8 WHERE de = 7`);
    console.log(`fase 7 -> 8: ${a.rowCount} cards, ${b.rowCount + c.rowCount} eventos`);
  } else {
    console.log("nada na fase 7 — renumeração dispensada");
  }

  /*
   * Notificações. `lida_em` nulo = ainda não vista; é por ela que o sino conta.
   * ON DELETE CASCADE no contrato: card apagado não deixa aviso órfão
   * apontando para nada.
   */
  await q(`
    CREATE TABLE IF NOT EXISTS contrato_notificacoes (
      id SERIAL PRIMARY KEY,
      contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios_bi(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      texto TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      lida_em TIMESTAMP
    )`);
  // O sino pergunta "o que falta ler para mim?" a cada minuto: o índice é
  // sobre exatamente essa pergunta.
  await q(`
    CREATE INDEX IF NOT EXISTS idx_contrato_notif_nao_lidas
    ON contrato_notificacoes (usuario_id, lida_em) WHERE lida_em IS NULL`);
  console.log("tabela contrato_notificacoes pronta");

  const { rows: depois } = await q(`
    SELECT fase, count(*)::int cards FROM contratos GROUP BY fase ORDER BY fase`);
  console.log("\ncards por fase depois:");
  console.table(depois);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
