#!/usr/bin/env node
/**
 * Apaga recebimentos lançados em duplicidade e fecha a brecha que os criou
 * (02/10/2026).
 *
 * O QUE ACONTECEU. Registrar um recebimento distribui a comissão na hora: o
 * BI cria uma baixa para cada pessoa do rateio. Em quatro negócios o
 * recebimento foi gravado DUAS vezes — mesmo valor, mesma data, ids
 * consecutivos —, então todo mundo ficou com duas baixas e o "Pago" da tela
 * de comissões subiu R$ 47.168 acima do devido.
 *
 * POR QUE A TRAVA NÃO PEGOU. A rota confere se o recebimento passa da
 * comissão do negócio, mas a conferência e a gravação são dois comandos
 * separados: no clique duplo as duas requisições leem "ainda não recebi nada"
 * antes de qualquer uma gravar, e as duas passam. É corrida clássica, e
 * nenhuma validação em dois passos resolve.
 *
 * O CONSERTO. Um índice ÚNICO em (negocio_id, data_recebimento, valor): o
 * banco passa a recusar a segunda gravação idêntica, não importa quantas
 * requisições cheguem juntas. O custo é que duas parcelas idênticas no mesmo
 * dia, para o mesmo negócio, deixam de ser aceitas — some num lançamento só,
 * ou mude a data. Em troca, o clique duplo para de custar dinheiro.
 *
 * A rota continua com a checagem de valor: ela pega o dígito a mais, que o
 * índice não pega.
 *
 * Uso: node scripts/limpar-recebimentos-duplicados.js [--aplicar]
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
  // Duplicata = mesmo negócio, mesma data, mesmo valor. Fica o de menor id,
  // que é o primeiro que a adm gravou.
  const { rows: sobrando } = await q(`
    SELECT fr.id, fr.negocio_id, fr.valor::float, to_char(fr.data_recebimento,'DD/MM/YYYY') data,
           p.unidade, to_char(p.competencia,'MM/YYYY') comp, n.ref,
           (SELECT count(*)::int FROM fechamento_pagamentos fp WHERE fp.recebimento_id = fr.id) baixas,
           (SELECT COALESCE(sum(fp.valor),0)::float FROM fechamento_pagamentos fp WHERE fp.recebimento_id = fr.id) valor_baixas
    FROM fechamento_recebimentos fr
    JOIN fechamento_negocios n ON n.id = fr.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE fr.id > (
      SELECT min(f2.id) FROM fechamento_recebimentos f2
      WHERE f2.negocio_id = fr.negocio_id AND f2.data_recebimento = fr.data_recebimento
        AND f2.valor = fr.valor)
    ORDER BY fr.negocio_id, fr.id`);

  console.log(`recebimentos duplicados: ${sobrando.length}`);
  sobrando.forEach((r) =>
    console.log(`   recebimento #${r.id} · negócio #${r.negocio_id} ${r.unidade} ${r.comp} ref ${r.ref} · R$ ${r.valor} em ${r.data} · ${r.baixas} baixas, R$ ${r.valor_baixas}`)
  );
  const total = sobrando.reduce((s, r) => s + r.valor, 0);
  const totalBaixas = sobrando.reduce((s, r) => s + r.valor_baixas, 0);
  console.log(`\nrecebimento a estornar: R$ ${total.toFixed(2)} · baixas que caem junto: R$ ${totalBaixas.toFixed(2)}`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  // As baixas saem por CASCADE: fechamento_pagamentos.recebimento_id tem
  // ON DELETE CASCADE para a tabela de recebimentos.
  const r = await q(`DELETE FROM fechamento_recebimentos WHERE id = ANY($1::int[])`,
    [sobrando.map((x) => x.id)]);
  console.log(`\nrecebimentos apagados: ${r.rowCount}`);

  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_recebimento_negocio_data_valor
    ON fechamento_recebimentos (negocio_id, data_recebimento, valor)`);
  console.log("índice único criado: um recebimento idêntico não grava duas vezes");

  const { rows: conferencia } = await q(`
    SELECT count(*)::int linhas_acima_do_devido FROM (
      SELECT rc.id,
             rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END) devido,
             COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id), 0) pago
      FROM fechamento_negocio_corretores rc
      JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
      JOIN fechamento_periodos p ON p.id = n.periodo_id) x
    WHERE pago > devido + 0.01`);
  console.log("linhas com pagamento acima do devido agora:", conferencia[0].linhas_acima_do_devido);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
