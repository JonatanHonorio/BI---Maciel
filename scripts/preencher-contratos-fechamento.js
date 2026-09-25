#!/usr/bin/env node
/**
 * Preenche o NÚMERO DO CONTRATO nos negócios de fechamento que entraram sem
 * ele (26/09/2026).
 *
 * De onde vêm os números: `FECHAMENTOS GERAIS DEPTO COMERCIAL - VENDAS.xlsx`,
 * cruzada com o BI por unidade + vertical + referência + VALOR EXATO. Os 112
 * casos desse cruzamento estão em `contratos_planilha_mestre.json`, junto com
 * o que foi conferido, para a operação poder ser auditada depois.
 *
 * Por que o valor entra na chave: a referência sozinha repete muito (a 58298 é
 * o Parque da Floresta inteiro, com dezenas de vendas). Ref + valor + unidade
 * não teve nenhum caso ambíguo — nenhum negócio casou com dois contratos.
 *
 * O que ficou de fora de propósito:
 *  - 8 linhas em que a coluna Contrato traz texto, não número ("Floresta",
 *    "MRV", "xxxx"): alguém usou a coluna como anotação;
 *  - Vista Verde, Esplanada e Lançamento, porque a planilha também não tem o
 *    número lá — esses só saem dos PDFs assinados.
 *
 * Cuidado registrado na memória: essa planilha NÃO é confiável para vendas
 * (datas erradas, negócios duplicados). Aqui isso pesa pouco porque nenhuma
 * data é usada e o valor precisa bater ao centavo, mas por isso mesmo o script
 * reconfere cada linha no banco antes de escrever e nunca sobrescreve um
 * número que já exista.
 *
 * Uso: node scripts/preencher-contratos-fechamento.js [--aplicar]
 * Sem --aplicar, só mostra o que faria.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APLICAR = process.argv.includes("--aplicar");

(async () => {
  const casos = JSON.parse(
    fs.readFileSync(path.join(__dirname, "contratos_planilha_mestre.json"), "utf-8")
  );

  const atual = (await pool.query(`
    SELECT n.id, n.ref, n.valor, n.contrato, p.unidade, p.tipo
    FROM fechamento_negocios n JOIN fechamento_periodos p ON p.id = n.periodo_id
  `)).rows;
  const porId = new Map(atual.map((r) => [r.id, r]));

  const aplicar = [];
  const pulados = { jaTem: 0, sumiu: 0, mudou: 0, naoNumerico: 0 };

  for (const c of casos) {
    if (!/^\d+$/.test(String(c.contrato).trim())) { pulados.naoNumerico++; continue; }
    const n = porId.get(c.id);
    if (!n) { pulados.sumiu++; continue; }
    if (n.contrato && String(n.contrato).trim()) { pulados.jaTem++; continue; }
    // Reconferência: o negócio pode ter sido editado depois da análise.
    const mesmo =
      String(n.ref).trim() === String(c.ref).trim() &&
      n.unidade === c.unidade &&
      Number(n.valor).toFixed(2) === Number(c.valor).toFixed(2);
    if (!mesmo) { pulados.mudou++; continue; }
    aplicar.push({ id: n.id, contrato: String(c.contrato).trim(), ref: n.ref, unidade: n.unidade });
  }

  console.log(`casos no arquivo: ${casos.length}`);
  console.log(`a preencher: ${aplicar.length}`);
  console.log(`pulados -> já tinham número: ${pulados.jaTem} · negócio não existe mais: ${pulados.sumiu} · dados mudaram: ${pulados.mudou} · não numérico: ${pulados.naoNumerico}`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    aplicar.slice(0, 5).forEach((a) => console.log(`  #${a.id} ${a.unidade} ref ${a.ref} -> contrato ${a.contrato}`));
    await pool.end();
    return;
  }

  let ok = 0;
  for (const a of aplicar) {
    // A condição do WHERE repete a trava: mesmo numa corrida com a adm
    // digitando o número na tela, o que ela escreveu ganha.
    const r = await pool.query(
      `UPDATE fechamento_negocios SET contrato = $2
       WHERE id = $1 AND (contrato IS NULL OR btrim(contrato) = '')`,
      [a.id, a.contrato]
    );
    ok += r.rowCount;
  }
  console.log(`\npreenchidos: ${ok}`);

  const [{ total, com }] = (await pool.query(`
    SELECT count(*)::int total, count(*) FILTER (WHERE btrim(coalesce(contrato,'')) <> '')::int com
    FROM fechamento_negocios
  `)).rows;
  console.log(`agora: ${com} de ${total} negócios com número de contrato`);

  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
