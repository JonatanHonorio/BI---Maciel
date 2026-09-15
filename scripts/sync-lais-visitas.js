#!/usr/bin/env node
/**
 * Importa visitas da Lais pro BI a partir de uma coleta feita em
 * casa.lais.ai/notifications (mesmo formato do coletor da skill
 * `visitas-lais`, ver .claude/skills/visitas-lais/scripts/coletar_lais.js).
 *
 * Diferença do importador antigo (import-lais-visitas.js, agora obsoleto):
 * aquele cruzava por NOME (`LIKE 'primeiro_nome%'`) e o próprio SKILL.md da
 * rotina de terça/sexta documenta que os "94% de acerto" dele incluíam
 * palpite. Este aqui cruza por TELEFONE -> clientes -> leads ->
 * lead_responsaveis (responsável mais recente), a mesma lógica em produção
 * de scripts/visitas-lais-gerentes.js — sem chute de homônimo.
 *
 * Uso: node scripts/sync-lais-visitas.js <coleta.json>
 *
 * <coleta.json>: array de { n, f, d, r, t, v } — ver coletar_lais.js.
 */
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const _CM = JSON.parse(fs.readFileSync(path.join(__dirname, "correcoes_manuais.json"), "utf-8"));
const CORRECOES = _CM.correcoes || {};

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("Uso: node scripts/sync-lais-visitas.js <coleta.json>");
  process.exit(1);
}

const chave = (b) => { const d = String(b || "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : null; };

function paraTimestamp(s) {
  const m = String(s || "").match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:00` : null;
}

/** Horário mais cedo dos propostos — mesma leitura conservadora do `--visita` de visitas-lais-gerentes.js. */
function horarioMaisCedo(v) {
  const ord = (s) => { const m = String(s).match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/); return m ? m[3] + m[2] + m[1] + m[4] + m[5] : "9".repeat(12); };
  const opcoes = String(v || "").split("|").map((s) => s.trim()).filter(Boolean).sort((a, b) => (ord(a) < ord(b) ? -1 : 1));
  return opcoes[0] || null;
}

const SQL = `
  WITH chave AS (SELECT * FROM unnest($1::text[], $2::timestamp[]) AS t(k, ref)),
  cli AS (
    SELECT ch.k, ch.ref, c.id AS cliente_id, c.nome, c.email FROM chave ch
    JOIN clientes c ON right(regexp_replace(COALESCE(c.celular,''),'\\D','','g'),9) = ch.k
                    OR right(regexp_replace(COALESCE(c.telefone,''),'\\D','','g'),9) = ch.k
  ),
  ordem AS (
    SELECT DISTINCT ON (cli.k) cli.k, cli.cliente_id, cli.nome, cli.email, l.id AS lead_id
    FROM cli JOIN leads l ON l.cliente_id = cli.cliente_id
    ORDER BY cli.k,
      CASE WHEN cli.ref IS NULL THEN NULL ELSE abs(extract(epoch FROM l.data_inicio - cli.ref)) END ASC NULLS LAST,
      l.data_inicio DESC NULLS LAST, l.id DESC
  ),
  resp AS (
    SELECT o.k, (ARRAY_AGG(r.corretor_id ORDER BY r.data DESC NULLS LAST, r.id DESC))[1] AS atual_id
    FROM ordem o JOIN lead_responsaveis r ON r.lead_id = o.lead_id
    WHERE r.corretor_id > 0
    GROUP BY o.k
  )
  SELECT o.k, o.cliente_id, o.nome AS cliente, o.email, o.lead_id,
    ca.id AS corretor_id,
    COALESCE(
      NULLIF(TRIM(ca.nome_comercial),''), NULLIF(TRIM(ca.nome),''),
      NULLIF(initcap(replace(split_part(COALESCE(ca.email,''),'@',1),'.',' ')),'')
    ) AS corretor
  FROM ordem o LEFT JOIN resp ON resp.k = o.k LEFT JOIN corretores ca ON ca.id = resp.atual_id
`;

(async () => {
  const bruto = JSON.parse(fs.readFileSync(arquivo, "utf-8"));

  // Dedup: a coleta pode repetir a mesma notificação (paginação, reagendamento no mesmo minuto).
  const mapa = new Map();
  for (const v of bruto) {
    const chv = `${v.f}|${v.r}|${v.d}`;
    if (!mapa.has(chv)) mapa.set(chv, v);
  }
  const visitas = [...mapa.values()];
  console.log(`coleta: ${bruto.length} notificações -> ${visitas.length} após dedup`);

  const chaves = visitas.map((v) => chave(v.f));
  const refs = visitas.map((v) => paraTimestamp(v.d));
  const r = await pool.query(SQL, [chaves, refs]);
  const porChave = new Map(r.rows.map((x) => [x.k, x]));

  // IDs de imóvel citados, para buscar bairro/cidade/codigo de uma vez.
  const idsImovel = [...new Set(visitas.map((v) => v.r).filter(Boolean).map((r) => r.replace(/\D/g, "")).filter(Boolean))];
  const imoveisRes = idsImovel.length
    ? await pool.query(`SELECT id, codigo, bairro, cidade FROM imoveis WHERE id = ANY($1::int[])`, [idsImovel])
    : { rows: [] };
  const porImovel = new Map(imoveisRes.rows.map((i) => [String(i.id), i]));

  let comCorretor = 0, semMatch = 0, comCorrecaoManual = 0;
  const linhas = [];

  for (const v of visitas) {
    const k = chave(v.f);
    const x = k ? porChave.get(k) : null;
    const imovelId = v.r ? v.r.replace(/\D/g, "") : null;
    const im = imovelId ? porImovel.get(imovelId) : null;

    let corretorId = null, corretorNome = null, matchMethod = "sem_match", leadId = null, clienteNome = v.n, clienteEmail = null;

    if (x && x.corretor) {
      corretorId = x.corretor_id; corretorNome = x.corretor; matchMethod = "telefone_lead_responsavel";
      leadId = x.lead_id; clienteNome = x.cliente || v.n; clienteEmail = x.email;
      comCorretor++;
    } else if (k && CORRECOES[k]) {
      // Correção manual (mesma lista usada pelos relatórios da Lais): telefone conferido
      // na tela do Kurole quando o cruzamento automático falha.
      corretorNome = CORRECOES[k].corretor; matchMethod = "correcao_manual";
      comCorrecaoManual++;
    } else {
      semMatch++;
    }

    const dataVisita = paraTimestamp(horarioMaisCedo(v.v)) || paraTimestamp(v.d);
    if (!dataVisita) continue; // sem data não dá pra gravar (é a chave de dedup da tabela)

    linhas.push({
      nome: (clienteNome || v.n || "").trim() || null,
      email: clienteEmail,
      tipo_transacao: v.t === "buy" ? "Venda" : v.t === "rent" ? "Aluguel" : null,
      data_criacao: paraTimestamp(v.d),
      data_visita: dataVisita,
      qtd_visitas: 1,
      bairro: im ? im.bairro : null,
      cidade: im ? im.cidade : null,
      localizacao: im && im.bairro ? `${im.bairro}${im.cidade ? ", " + im.cidade : ""}` : null,
      id_imovel: v.r || null,
      // imoveis.codigo está gravado como "0" na maioria das linhas — usa a
      // ref da própria Lais (ex: "L64000"), que é sempre preenchida.
      referencia_imovel: (im && im.codigo && im.codigo !== "0") ? im.codigo : (v.r || null),
      corretor_nome: corretorNome,
      corretor_id: corretorId,
      match_method: matchMethod,
      lead_id: leadId,
    });
  }

  console.log(`com corretor (telefone): ${comCorretor} | correção manual: ${comCorrecaoManual} | sem match: ${semMatch}`);

  let gravados = 0;
  for (const l of linhas) {
    await pool.query(
      `INSERT INTO lais_visitas
         (nome, email, tipo_transacao, origem, status, data_criacao, data_visita, qtd_visitas,
          bairro, cidade, localizacao, id_imovel, referencia_imovel, corretor_nome, corretor_id, match_method, lead_id)
       VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (nome, email, data_visita) DO UPDATE SET
         corretor_nome = EXCLUDED.corretor_nome, corretor_id = EXCLUDED.corretor_id,
         match_method = EXCLUDED.match_method, lead_id = EXCLUDED.lead_id,
         bairro = EXCLUDED.bairro, cidade = EXCLUDED.cidade, localizacao = EXCLUDED.localizacao,
         referencia_imovel = EXCLUDED.referencia_imovel, tipo_transacao = EXCLUDED.tipo_transacao,
         id_imovel = EXCLUDED.id_imovel`,
      [l.nome, l.email, l.tipo_transacao, l.data_criacao, l.data_visita, l.qtd_visitas,
       l.bairro, l.cidade, l.localizacao, l.id_imovel, l.referencia_imovel,
       l.corretor_nome, l.corretor_id, l.match_method, l.lead_id]
    );
    gravados++;
  }

  console.log(`\n${gravados} visitas gravadas/atualizadas em lais_visitas.`);
  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
