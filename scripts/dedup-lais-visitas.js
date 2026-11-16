#!/usr/bin/env node
/**
 * DUPLICATAS DE lais_visitas — levantamento e (com --aplicar) limpeza.
 *
 * A causa: o upsert do sync casa por `ON CONFLICT (nome, email, data_visita)`,
 * e no Postgres **dois NULL nunca colidem**. Toda visita sem e-mail escapa do
 * conflito e é INSERIDA DE NOVO a cada sync — uma cópia por dia de rotina.
 *
 * Por isso o conserto tem duas partes. Esta aqui junta as cópias; a outra é
 * trocar o índice único por um que não deixe o NULL escapar, senão amanhã
 * tudo volta. Ver --indice.
 *
 * IDENTIDADE DE UMA VISITA: `data_visita` + imóvel + pessoa. As três, e não
 * menos:
 *
 *  - SEM IMÓVEL não dá para afirmar nada. A primeira versão deste script
 *    agrupou só por data+imóvel e as ~700 linhas antigas com `id_imovel`
 *    vazio caíram todas juntas por coincidência de horário — gente diferente
 *    virando "duplicata". Linha sem imóvel fica fora do plano, sempre.
 *  - NOMES DIFERENTES no mesmo imóvel e horário SE JUNTAM, por decisão do
 *    Jonatan em 16/11/2026, depois de ver os 14 casos: são todos a mesma
 *    pessoa escrita de dois jeitos ("grazi" / "grazi shimizu", "taty" /
 *    "tatiane"), porque o sync grava o nome do Kurole quando acha o lead e o
 *    da Lais quando não acha. Sobrevive a linha mais completa COM O NOME QUE
 *    ELA JÁ TEM — ver, no laço, por que mexer no nome é tiro no pé.
 *
 * QUAL LINHA FICA: a mais completa, nesta ordem — tem corretor, tem CPF, tem
 * e-mail, tem lead, e por fim a mais nova (id maior). Os campos que faltarem
 * na vencedora são preenchidos a partir das irmãs antes de elas saírem, para
 * a limpeza nunca perder informação.
 *
 * GRUPO COM CORRETOR DIVERGENTE fica de fora por padrão: juntar muda **a quem
 * a visita é atribuída**, e isso entra no ranking. Com `--corretor-recente`
 * ele entra, mantendo a linha mais nova — o Jonatan decidiu assim em
 * 16/11/2026, porque o sync recalcula o responsável a cada rodada a partir do
 * `lead_responsaveis`, então a linha mais nova carrega o vínculo mais atual.
 *
 * Nesse modo a vencedora NÃO herda corretor, lead nem match_method das irmãs
 * — herdar justamente o que está em disputa desfaria a escolha. Só campos
 * neutros (CPF, e-mail, bairro, valor de referência) são completados.
 *
 * Uso:
 *   node scripts/dedup-lais-visitas.js              # só mostra o que sairia
 *   node scripts/dedup-lais-visitas.js --aplicar    # apaga, com backup antes
 *   node scripts/dedup-lais-visitas.js --corretor-recente [--aplicar]
 *   node scripts/dedup-lais-visitas.js --indice     # mostra o SQL do índice
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const departamentos = require("../src/lib/departamentos.json").departamentos;

const APLICAR = process.argv.includes("--aplicar");
const INDICE = process.argv.includes("--indice");
const CORRETOR_RECENTE = process.argv.includes("--corretor-recente");

/** Campos que a vencedora pode herdar das irmãs. */
const NEUTROS = ["cpf", "email", "bairro", "cidade", "localizacao",
                 "referencia_imovel", "tipo_transacao"];
/** Só quando não há disputa de atribuição. */
const DO_VINCULO = ["corretor_id", "corretor_nome", "lead_id"];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};

const SQL_INDICE = `
-- ✅ JÁ APLICADO EM 16/11/2026, junto com a limpeza das 122 linhas. Fica aqui
-- como registro: é o que impede a duplicação de voltar.
--
-- O COALESCE faz a linha sem e-mail colidir consigo mesma, que é o que o NULL
-- impedia. Note que o DROP é da CONSTRAINT, não do índice: o índice antigo
-- pertencia a uma constraint UNIQUE e o Postgres recusa soltá-lo direto.
CREATE UNIQUE INDEX lais_visitas_visita_key
  ON lais_visitas (COALESCE(nome,''), COALESCE(email,''), data_visita);
ALTER TABLE lais_visitas DROP CONSTRAINT lais_visitas_nome_email_data_visita_key;
-- e no sync: ON CONFLICT (COALESCE(nome,''), COALESCE(email,''), data_visita)`;

const unidadeDe = (depId) => {
  const nome = departamentos[String(depId)];
  if (!nome) return "—";
  const m = nome.match(/^(Gerente\s+)?(Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  return m ? m[3].trim() : nome;
};

(async () => {
  if (INDICE) { console.log(SQL_INDICE); await pool.end(); return; }

  const { rows } = await q(`
    SELECT lv.id, lv.nome, lv.email, lv.cpf, lv.data_visita, lv.id_imovel,
           lv.corretor_id, lv.corretor_nome, lv.lead_id, lv.match_method,
           lv.tipo_transacao, lv.bairro, lv.cidade, lv.localizacao,
           lv.referencia_imovel, lv.created_at, c.departamento_id
    FROM lais_visitas lv
    LEFT JOIN corretores c ON c.id = lv.corretor_id
    ORDER BY lv.data_visita, lv.id`);

  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  // Linha sem imóvel não entra: não há como afirmar que duas delas são a
  // mesma visita, e agrupar por horário sozinho junta gente diferente.
  const semImovel = rows.filter(r => !r.id_imovel);
  const comImovel = rows.filter(r => r.id_imovel);

  // Uma visita = um imóvel num horário. O nome não entra na chave: ver o
  // cabeçalho sobre "grazi" / "grazi shimizu".
  const grupos = new Map();
  for (const r of comImovel) {
    const slot = `${r.data_visita.toISOString()}|${r.id_imovel}`;
    if (!grupos.has(slot)) grupos.set(slot, []);
    grupos.get(slot).push(r);
  }

  const pontos = (r) =>
    (r.corretor_id ? 8 : 0) + (r.cpf ? 4 : 0) + (r.email ? 2 : 0) + (r.lead_id ? 1 : 0);

  const planoSaida = [];      // linhas a apagar
  const completar = [];       // {id, campos} da vencedora
  const divergentes = [];     // grupos em disputa, deixados como estão
  const resolvidos = [];      // grupos em disputa resolvidos pela linha mais nova
  const porCorretor = new Map();

  for (const [k, g] of grupos) {
    if (g.length < 2) continue;

    // Mesmo imóvel e horário, corretores diferentes: ou o atendimento trocou
    // de mão, ou um dos vínculos está errado.
    const corretores = [...new Set(g.map(r => r.corretor_id).filter(Boolean))];
    const disputado = corretores.length > 1;
    if (disputado && !CORRETOR_RECENTE) { divergentes.push({ k, g }); continue; }

    // Em disputa vence a linha MAIS NOVA, que carrega o vínculo mais atual —
    // e não a mais completa, senão uma linha velha e gorda levaria o crédito.
    const ordenado = disputado
      ? [...g].sort((a, b) => b.id - a.id)
      : [...g].sort((a, b) => pontos(b) - pontos(a) || b.id - a.id);
    const fica = ordenado[0];
    const saem = ordenado.slice(1);
    if (disputado) resolvidos.push({ fica, saem });

    // Nada se perde: o que falta na vencedora vem das irmãs. Em disputa, só
    // campos neutros — herdar o corretor desfaria a escolha que acabou de
    // ser feita.
    const faltando = {};
    for (const campo of disputado ? NEUTROS : [...NEUTROS, ...DO_VINCULO]) {
      if (fica[campo] === null || fica[campo] === undefined || fica[campo] === "") {
        const doado = saem.find(r => r[campo] !== null && r[campo] !== undefined && r[campo] !== "");
        if (doado) faltando[campo] = doado[campo];
      }
    }
    /*
     * O NOME NÃO SE TOCA — e isso custou uma lição em 16/11/2026.
     *
     * A primeira versão trocava o nome da vencedora pelo mais completo do
     * grupo ("MILENE" -> "Milene Dias Alves Miranda"), achando que guardava
     * mais informação. Mas `nome` é parte da CHAVE do upsert: o sync grava o
     * nome do cliente como está no Kurole, não achou mais a linha renomeada e
     * inseriu outra no dia seguinte. Melhorar um campo da chave reabre
     * exatamente o buraco que esta limpeza veio fechar.
     *
     * O nome certo é o que o sync reproduz. Se ele estiver feio, o lugar de
     * arrumar é o cadastro no Kurole.
     */

    if (Object.keys(faltando).length) completar.push({ id: fica.id, campos: faltando });

    for (const r of saem) planoSaida.push({ ...r, ficou: fica.id });

    const quem = fica.corretor_nome || "— sem corretor identificado —";
    const uni = fica.departamento_id ? unidadeDe(fica.departamento_id) : "—";
    const chave = `${quem}|${uni}`;
    if (!porCorretor.has(chave)) porCorretor.set(chave, { quem, uni, linhas: 0, visitas: 0 });
    const acc = porCorretor.get(chave);
    acc.linhas += saem.length;
    acc.visitas += 1;
  }

  const total = rows.length;
  console.log(`lais_visitas: ${total} linhas hoje`);
  console.log(`  fora do plano por não ter imóvel: ${semImovel.length} linhas (não dá pra afirmar que são a mesma visita)`);
  console.log(`grupos duplicados (mesma pessoa+imóvel+horário): ${[...grupos.values()].filter(g => g.length > 1).length - divergentes.length}`);
  console.log(`LINHAS QUE SAIRIAM: ${planoSaida.length}  ->  tabela ficaria com ${total - planoSaida.length}`);
  console.log(`vencedoras que ganham campo das irmãs: ${completar.length}`);

  console.log(`\n== DE QUEM SÃO (por corretor da visita que FICA) ==`);
  const lista = [...porCorretor.values()].sort((a, b) => b.linhas - a.linhas);
  for (const x of lista) {
    console.log(`  ${String(x.linhas).padStart(3)} linhas · ${String(x.visitas).padStart(3)} visitas · ${x.uni.padEnd(12)} ${x.quem}`);
  }

  console.log(`\n== POR UNIDADE ==`);
  const porUni = new Map();
  for (const x of lista) porUni.set(x.uni, (porUni.get(x.uni) || 0) + x.linhas);
  for (const [u, n] of [...porUni].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} · ${u}`);

  console.log(`\n== AS 15 PIORES VISITAS (mais cópias) ==`);
  const piores = [...grupos.entries()].filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  for (const [k, g] of piores) {
    const [dt, im] = k.split("|");
    console.log(`  ${g.length}x · ${dt.slice(0, 16).replace("T", " ")} · ${im} · ${g[0].nome} · ${g[0].corretor_nome || "sem corretor"}`);
  }

  // Onde o grupo tinha nomes diferentes, mostra qual nome sobrevive.
  const renomeia = completar.filter(c => c.campos.nome);
  if (renomeia.length) {
    console.log(`\n== GRUPOS COM NOME DIFERENTE: ${renomeia.length} (fica o mais completo) ==`);
    for (const c of renomeia) {
      const antes = rows.find(r => r.id === c.id);
      console.log(`  #${c.id} "${antes ? antes.nome : "?"}" -> "${c.campos.nome}"`);
    }
  }

  if (resolvidos.length) {
    console.log(`\n== CORRETOR EM DISPUTA: ${resolvidos.length} grupos, fica a linha mais nova ==`);
    for (const { fica, saem } of resolvidos) {
      const perdem = saem.map(r => `#${r.id} ${r.corretor_nome || "?"}`).join(", ");
      console.log(`  ${String(fica.data_visita.toISOString()).slice(0, 16).replace("T", " ")} · ${fica.id_imovel}`);
      console.log(`     fica  #${fica.id} ${fica.corretor_nome || "sem corretor"}`);
      console.log(`     saem  ${perdem}`);
    }
  }

  if (divergentes.length) {
    console.log(`\n⚠️ CORRETORES DIFERENTES no mesmo imóvel/horário — ficam como estão (use --corretor-recente):`);
    for (const { k, g } of divergentes) {
      const [dt, im] = k.split("|");
      console.log(`  ${dt.slice(0, 16).replace("T", " ")} · ${im} · ${g.map(r => `#${r.id} ${r.corretor_nome || "?"}`).join(" | ")}`);
    }
  }

  if (!APLICAR) {
    console.log(`\n(simulação — nada foi apagado. Rode com --aplicar)`);
    console.log(`Depois de aplicar, o índice precisa mudar: --indice`);
    await pool.end();
    return;
  }

  const arq = path.join(__dirname, `backup-lais-dedup-${Date.now()}.json`);
  fs.writeFileSync(arq, JSON.stringify({ apagadas: planoSaida, completadas: completar }, null, 2), "utf-8");
  console.log(`\nbackup: ${arq}`);

  for (const c of completar) {
    const campos = Object.keys(c.campos);
    const set = campos.map((k, i) => `${k} = $${i + 2}`).join(", ");
    await q(`UPDATE lais_visitas SET ${set} WHERE id = $1`, [c.id, ...campos.map(k => c.campos[k])]);
  }
  console.log(`${completar.length} vencedoras completadas`);

  const ids = planoSaida.map(r => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    await q(`DELETE FROM lais_visitas WHERE id = ANY($1::int[])`, [ids.slice(i, i + 200)]);
  }
  const [{ n }] = (await q(`SELECT count(*)::int n FROM lais_visitas`)).rows;
  console.log(`${ids.length} linhas apagadas · tabela agora com ${n}`);
  console.log(`\nFALTA O ÍNDICE, senão volta amanhã:\n${SQL_INDICE}`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
