#!/usr/bin/env node
/**
 * Data de INÍCIO do contrato no fechamento (05/10/2026).
 *
 * O fechamento guardava uma data só — a da assinatura. Em locação as duas
 * datas são diferentes com frequência: no Kurole, 2.468 dos 4.009 contratos de
 * locação (62%) têm início em dia diferente do da assinatura, e 85 dos lançados
 * de dez/2025 pra cá têm as duas datas em MESES diferentes (assina em 30/09,
 * a chave entra em 10/10).
 *
 * A competência NÃO muda: "a locação vale pro mês que o contrato foi assinado,
 * ou seja toda documentação foi recolhida e a negociação foi concluída"
 * (Jonatan, 05/10/2026). O início entra como informação ao lado, não como
 * critério de mês — por isso esta migração não remaneja negócio nenhum.
 *
 * O preenchimento retroativo vem do Kurole, casando pelo NÚMERO DO CONTRATO
 * dentro da vertical (`conversoes.contrato_numero` + `locacao_venda`), que é a
 * mesma chave que a busca por CT do formulário usa. Negócio sem CT fica sem
 * início — não há de onde tirar.
 *
 * ⚠️ Datas impossíveis do Kurole são descartadas: existem contratos com
 * assinatura em 2218 e 2027 (erro de digitação na origem, CT 1753 e 1347). A
 * janela de sanidade evita trazer isso pra dentro do BI.
 *
 * Uso: node scripts/add-negocio-data-inicio.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: só preenche o que está vazio.
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

// Contrato de locação não começa antes de a imobiliária existir no sistema nem
// depois de amanhã + alguns anos. Fora disso é digitação errada na origem.
const JANELA = ["2015-01-01", "2032-12-31"];

(async () => {
  const [{ existe }] = (await q(`
    SELECT count(*)::int existe FROM information_schema.columns
    WHERE table_name = 'fechamento_negocios' AND column_name = 'data_inicio'`)).rows;
  console.log(`coluna data_inicio: ${existe ? "já existe" : "a criar"}`);

  if (APLICAR && !existe) {
    await q(`ALTER TABLE fechamento_negocios ADD COLUMN IF NOT EXISTS data_inicio DATE`);
    console.log("coluna criada");
  }
  if (!existe && !APLICAR) {
    console.log("\n(simulação — rode com --aplicar para criar a coluna e preencher)");
    await pool.end();
    return;
  }

  // Quem dá pra preencher: locação, com CT, ainda sem início, e com conversão
  // correspondente no Kurole.
  const alvo = `
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'locacao'
    JOIN conversoes cv
      ON cv.contrato_numero = NULLIF(regexp_replace(COALESCE(n.contrato, ''), '\\D', '', 'g'), '')::int
     AND cv.locacao_venda = 'L'
    WHERE NOT n.cancelado
      AND n.data_inicio IS NULL
      AND cv.data_inicio IS NOT NULL
      AND cv.data_inicio::date BETWEEN $1::date AND $2::date`;

  const { rows: previa } = await q(`
    SELECT p.unidade, to_char(p.competencia,'MM/YYYY') comp, n.ref, n.contrato,
           n.data_contrato assinatura, cv.data_inicio::date inicio,
           (cv.data_inicio::date - n.data_contrato) dias
    ${alvo} ORDER BY p.competencia, p.unidade LIMIT 12`, JANELA);
  const [{ total }] = (await q(`SELECT count(*)::int total ${alvo}`, JANELA)).rows;
  const [{ mes_diferente }] = (await q(`
    SELECT count(*)::int mes_diferente ${alvo}
      AND date_trunc('month', cv.data_inicio::date) <> date_trunc('month', n.data_contrato)`, JANELA)).rows;

  console.log(`\nlocações que ganham data de início: ${total}`);
  console.log(`dessas, com início em mês diferente da assinatura: ${mes_diferente}`);
  console.log("\namostra:");
  console.table(previa);

  // Quem fica de fora, e por quê — pra ninguém procurar depois.
  const { rows: fora } = await q(`
    SELECT count(*) FILTER (WHERE btrim(coalesce(n.contrato,'')) = '')::int sem_ct,
           count(*) FILTER (WHERE btrim(coalesce(n.contrato,'')) <> ''
             AND NOT EXISTS (SELECT 1 FROM conversoes c2
               WHERE c2.contrato_numero = NULLIF(regexp_replace(n.contrato, '\\D', '', 'g'), '')::int
                 AND c2.locacao_venda = 'L'))::int ct_sem_conversao
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'locacao'
    WHERE NOT n.cancelado AND n.data_inicio IS NULL`);
  console.log("ficam sem início:", fora[0]);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const r = await q(`
    UPDATE fechamento_negocios n SET data_inicio = cv.data_inicio::date
    FROM fechamento_periodos p, conversoes cv
    WHERE p.id = n.periodo_id AND p.tipo = 'locacao'
      AND cv.contrato_numero = NULLIF(regexp_replace(COALESCE(n.contrato, ''), '\\D', '', 'g'), '')::int
      AND cv.locacao_venda = 'L'
      AND NOT n.cancelado AND n.data_inicio IS NULL
      AND cv.data_inicio IS NOT NULL
      AND cv.data_inicio::date BETWEEN $1::date AND $2::date`, JANELA);
  console.log(`\nlocações preenchidas: ${r.rowCount}`);

  const [s] = (await q(`
    SELECT count(*)::int locacoes, count(n.data_inicio)::int com_inicio
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'locacao'
    WHERE NOT n.cancelado`)).rows;
  console.log(`locações com data de início: ${s.com_inicio} de ${s.locacoes}`);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
