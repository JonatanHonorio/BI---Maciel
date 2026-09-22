// Confere as vendas do Parque Floresta contra a regra própria daquele
// lançamento e IMPRIME o que está fora do padrão. Não altera nada.
//
// O Jonatan pediu (22/09/2026) que erro de digitação nos retroativos NÃO seja
// corrigido na hora: as gerentes estão lançando muita venda antiga de uma vez
// e ele revisa tudo no fim. Este script é a lista dessa revisão.
//
// Padrão esperado (ref 58298, Loteamento Floresta, venda):
//   levantamento  Fabiana Oliveira 2,5% + Suely Andrade 2,5%
//   lancamento    Sirley 10%
//   fechamento    30%   ·   gerencia 10%   ·   diretorias 3% / 1% / 0,5%
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ESPERADO = {
  levantamento: 0.05, lancamento: 0.10, fechamento: 0.30, gerencia: 0.10,
  diretoria_1: 0.03, diretoria_2: 0.01, diretoria_3: 0.005,
};
const NOMES_CAPTACAO = ["Fabiana Oliveira", "Suely Andrade"];

(async () => {
  const { rows } = await pool.query(`
    SELECT nn.id, p.unidade, nn.ref, nn.comissao,
      json_agg(json_build_object(
        'papel', rc.papel, 'percentual', rc.percentual,
        'nome', COALESCE(NULLIF(TRIM(c.nome_comercial),''), NULLIF(TRIM(c.nome),''), rc.nome_livre)
      ) ORDER BY rc.papel) AS rateio
    FROM fechamento_negocios nn
    JOIN fechamento_periodos p ON p.id = nn.periodo_id
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = nn.id
    LEFT JOIN corretores c ON c.id = rc.corretor_id
    WHERE p.tipo = 'venda' AND nn.endereco ILIKE '%floresta%'
    GROUP BY nn.id, p.unidade, nn.ref, nn.comissao
    ORDER BY p.unidade, nn.id
  `);

  console.log(`Vendas do Floresta: ${rows.length}\n`);
  let comProblema = 0;

  for (const n of rows) {
    const avisos = [];
    const porPapel = {};
    for (const r of n.rateio) {
      if (!r.papel) continue;
      (porPapel[r.papel] ??= []).push(r);
    }

    for (const [papel, esperado] of Object.entries(ESPERADO)) {
      const linhas = porPapel[papel] ?? [];
      if (!linhas.length) { avisos.push(`sem ${papel}`); continue; }
      const soma = linhas.reduce((s, l) => s + Number(l.percentual), 0);
      // Tolerância de 1 centésimo de ponto percentual: 2,5+2,5 dá dízima em
      // alguns arredondamentos e não é erro de digitação.
      if (Math.abs(soma - esperado) > 0.0001) {
        avisos.push(`${papel} soma ${(soma * 100).toFixed(2)}% (esperado ${(esperado * 100).toFixed(2)}%)`);
      }
    }

    // Nome fora da grafia combinada vira OUTRO destinatário no relatório de
    // pagamento — é o erro que passa mais despercebido.
    for (const l of porPapel.levantamento ?? []) {
      if (!NOMES_CAPTACAO.includes(l.nome)) avisos.push(`captação como "${l.nome}"`);
    }
    for (const l of porPapel.lancamento ?? []) {
      if (l.nome !== "Sirley") avisos.push(`lançamento como "${l.nome}"`);
    }

    if (avisos.length) {
      comProblema++;
      console.log(`#${n.id} ${n.unidade} ref ${n.ref} (comissão ${n.comissao})`);
      for (const a of avisos) console.log(`    - ${a}`);
    }
  }

  console.log(comProblema ? `\n${comProblema} venda(s) fora do padrão.` : "\nTudo dentro do padrão.");

  // ------------------------------------------------ nomes quase iguais
  // Vale pra TODOS os negocios, nao so o Floresta. Enquanto o rateio aceita
  // nome digitado, "Fabiana oliveira" e "Fabiana Oliveira" sao duas pessoas
  // diferentes no relatorio de pagamento - e nada na tela denuncia isso.
  const { rows: nomes } = await pool.query(`
    SELECT rc.nome_livre AS nome, count(*)::int AS n
    FROM fechamento_negocio_corretores rc
    WHERE rc.nome_livre IS NOT NULL AND rc.corretor_id IS NULL
    GROUP BY 1 ORDER BY 1
  `);
  const chave = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  const grupos = new Map();
  for (const r of nomes) {
    const k = chave(r.nome);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }

  console.log("\n--- mesma pessoa escrita de formas diferentes ---");
  const duplicados = [...grupos.values()].filter((g) => g.length > 1);
  if (!duplicados.length) console.log("  nenhum.");
  for (const g of duplicados) {
    console.log("  " + g.map((r) => `"${r.nome}" (${r.n}x)`).join("  vs  "));
  }

  // Um nome contido no outro: pega "omerciaFabiana Oliveira", que a
  // comparacao exata nao ve.
  console.log("\n--- um nome contido no outro (possivel erro de digitacao) ---");
  const ks = [...grupos.keys()];
  let achou = false;
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      if (ks[i].includes(ks[j]) || ks[j].includes(ks[i])) {
        achou = true;
        console.log(`  "${grupos.get(ks[i])[0].nome}"  x  "${grupos.get(ks[j])[0].nome}"`);
      }
    }
  }
  if (!achou) console.log("  nenhum.");

  await pool.end();
})();
