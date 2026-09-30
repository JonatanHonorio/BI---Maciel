#!/usr/bin/env node
/**
 * Marca como ENVIADO os períodos de fechamento de uma faixa de competência
 * (28/09/2026).
 *
 * Por que existe: as adms lançaram o ano inteiro e nunca apertaram "Enviar" —
 * acharam que bastava cadastrar. O Jonatan mandou travar de dez/2025 a
 * ago/2026 em vez de pedir 70 cliques à Tatiane, deixando **setembro aberto**,
 * que ainda está em digitação.
 *
 * O que travar significa: depois de enviado, só `admin` edita, exclui ou
 * acrescenta negócio no mês (ver `periodoEditavel` na rota do negócio). É a
 * trava que faz do fechamento um número oficial. Cancelamento, correção de
 * valor/comissão e baixa de comissão continuam funcionando — essas rotas são
 * de propósito indiferentes ao status, porque distrato e acerto chegam depois
 * do mês fechado.
 *
 * Período VAZIO fica de fora: mês sem nenhum negócio ou é locação que ainda
 * não foi lançada, ou é um período criado por engano ao abrir a tela. Travar
 * um mês vazio não oficializa nada e ainda obrigaria a pedir reabertura.
 *
 * `enviado_por` fica com o id do Jonatan (1), que é quem autorizou — a coluna
 * serve para saber de quem foi o ato, e atribuí-lo a uma adm que não clicou
 * seria falso.
 *
 * Uso: node scripts/enviar-periodos-fechamento.js [--aplicar]
 * Sem --aplicar, só mostra o que faria. Idempotente (período já enviado é
 * ignorado).
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APLICAR = process.argv.includes("--aplicar");

const DE = "2025-12-01";
const ATE = "2026-08-01"; // inclusive
const AUTOR = 1; // Jonatan Honório, admin

(async () => {
  const { rows } = await pool.query(
    `SELECT p.id, p.unidade, p.tipo, to_char(p.competencia,'MM/YYYY') comp, p.status,
            count(n.id)::int negocios
     FROM fechamento_periodos p
     LEFT JOIN fechamento_negocios n ON n.periodo_id = p.id
     WHERE p.competencia BETWEEN $1 AND $2
     GROUP BY p.id ORDER BY p.competencia, p.unidade, p.tipo`,
    [DE, ATE]
  );

  const enviar = rows.filter((r) => r.status === "aberto" && r.negocios > 0);
  const vazios = rows.filter((r) => r.status === "aberto" && r.negocios === 0);
  const jaEnviados = rows.filter((r) => r.status === "enviado");

  console.log(`períodos na faixa ${DE} a ${ATE}: ${rows.length}`);
  console.log(`  a enviar: ${enviar.length}  ·  vazios (ficam abertos): ${vazios.length}  ·  já enviados: ${jaEnviados.length}`);
  if (vazios.length) {
    console.log("\nvazios, continuam abertos:");
    vazios.forEach((v) => console.log(`   ${v.unidade} ${v.tipo} ${v.comp}`));
  }

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  const ids = enviar.map((r) => r.id);
  const r = await pool.query(
    `UPDATE fechamento_periodos
     SET status = 'enviado', enviado_por = $2, enviado_em = NOW()
     WHERE id = ANY($1::int[]) AND status = 'aberto'`,
    [ids, AUTOR]
  );
  console.log(`\nenviados: ${r.rowCount}`);

  const { rows: resumo } = await pool.query(
    `SELECT to_char(competencia,'YYYY-MM') comp, status, count(*)::int periodos
     FROM fechamento_periodos GROUP BY 1,2 ORDER BY 1,2`
  );
  console.table(resumo);

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
