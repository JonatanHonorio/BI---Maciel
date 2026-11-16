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
 *  - NOMES DIFERENTES no mesmo imóvel e horário não se juntam. Pode ser a
 *    mesma visita (o sync grava o nome do Kurole quando acha o lead e o da
 *    Lais quando não acha) ou duas pessoas de verdade — e o script não tem
 *    como saber. Esses grupos saem numa lista à parte, para olho humano.
 *
 * QUAL LINHA FICA: a mais completa, nesta ordem — tem corretor, tem CPF, tem
 * e-mail, tem lead, e por fim a mais nova (id maior). Os campos que faltarem
 * na vencedora são preenchidos a partir das irmãs antes de elas saírem, para
 * a limpeza nunca perder informação.
 *
 * ⚠️ GRUPO COM CORRETOR DIVERGENTE NÃO É DUPLICATA e sai do plano sozinho:
 * dois corretores no mesmo imóvel e horário é outra coisa, e quem decide é
 * gente, não script.
 *
 * Uso:
 *   node scripts/dedup-lais-visitas.js              # só mostra o que sairia
 *   node scripts/dedup-lais-visitas.js --aplicar    # apaga, com backup antes
 *   node scripts/dedup-lais-visitas.js --indice     # mostra o SQL do índice
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const departamentos = require("../src/lib/departamentos.json").departamentos;

const APLICAR = process.argv.includes("--aplicar");
const INDICE = process.argv.includes("--indice");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};

const SQL_INDICE = `
-- Depois de limpar, troque o índice. COALESCE(email,'') faz a linha sem
-- e-mail colidir consigo mesma, que é o que o NULL impedia.
DROP INDEX IF EXISTS lais_visitas_nome_email_data_visita_key;
CREATE UNIQUE INDEX lais_visitas_visita_key
  ON lais_visitas (nome, COALESCE(email, ''), data_visita);
-- e no sync: ON CONFLICT (nome, COALESCE(email,''), data_visita)`;

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

  // Grupo "forte": mesma pessoa, mesmo imóvel, mesmo horário.
  const grupos = new Map();
  // Grupo "fraco": mesmo imóvel e horário, nomes diferentes — só para listar.
  const porSlot = new Map();
  for (const r of comImovel) {
    const slot = `${r.data_visita.toISOString()}|${r.id_imovel}`;
    const k = `${slot}|${norm(r.nome)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
    if (!porSlot.has(slot)) porSlot.set(slot, new Set());
    porSlot.get(slot).add(norm(r.nome));
  }

  const pontos = (r) =>
    (r.corretor_id ? 8 : 0) + (r.cpf ? 4 : 0) + (r.email ? 2 : 0) + (r.lead_id ? 1 : 0);

  const planoSaida = [];      // linhas a apagar
  const completar = [];       // {id, campos} da vencedora
  const divergentes = [];     // grupos que NÃO são duplicata
  const porCorretor = new Map();

  for (const [k, g] of grupos) {
    if (g.length < 2) continue;

    // Mesma pessoa, mesmo imóvel e horário, mas corretores diferentes: ou o
    // atendimento trocou de mão, ou um dos vínculos está errado. Decide gente.
    const corretores = [...new Set(g.map(r => r.corretor_id).filter(Boolean))];
    if (corretores.length > 1) { divergentes.push({ k, g }); continue; }

    const ordenado = [...g].sort((a, b) => pontos(b) - pontos(a) || b.id - a.id);
    const fica = ordenado[0];
    const saem = ordenado.slice(1);

    // Nada se perde: o que falta na vencedora vem das irmãs.
    const faltando = {};
    for (const campo of ["cpf", "email", "corretor_id", "corretor_nome", "lead_id",
                         "bairro", "cidade", "localizacao", "referencia_imovel", "tipo_transacao"]) {
      if (fica[campo] === null || fica[campo] === undefined || fica[campo] === "") {
        const doado = saem.find(r => r[campo] !== null && r[campo] !== undefined && r[campo] !== "");
        if (doado) faltando[campo] = doado[campo];
      }
    }
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

  // Mesmo imóvel e horário, nomes diferentes: não mexo, mas o Jonatan precisa
  // ver — parte disso pode ser a mesma visita com o nome gravado de dois
  // jeitos, e aí sobra duplicata depois da limpeza.
  const nomesDiferentes = [...porSlot.entries()].filter(([, s]) => s.size > 1);
  if (nomesDiferentes.length) {
    const extra = nomesDiferentes.reduce((s, [, n]) => s + n.size - 1, 0);
    console.log(`\n== MESMO IMÓVEL E HORÁRIO, NOMES DIFERENTES: ${nomesDiferentes.length} (NÃO entram no plano; juntá-los tiraria +${extra} linhas) ==`);
    for (const [slot, nomes] of nomesDiferentes.slice(0, 20)) {
      const [dt, im] = slot.split("|");
      console.log(`  ${dt.slice(0, 16).replace("T", " ")} · ${im} · ${[...nomes].join(" / ")}`);
    }
    if (nomesDiferentes.length > 20) console.log(`  ... e mais ${nomesDiferentes.length - 20}`);
  }

  if (divergentes.length) {
    console.log(`\n⚠️ NÃO SÃO DUPLICATA (corretores diferentes no mesmo imóvel/horário) — ficam como estão:`);
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
