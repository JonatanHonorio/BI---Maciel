#!/usr/bin/env node
/**
 * Produtividade por corretor no mês: leads recebidos, captações, atualizações.
 *
 * Uso: node scripts/produtividade-mes.js [AAAA-MM]   (padrão: mês corrente)
 *
 * --- DEFINIÇÕES (decididas pelo Jonatan em 14/09/2026) ---
 *
 * LEADS RECEBIDOS = por ATRIBUIÇÃO (`lead_responsaveis.data`), não por abertura
 *   da ordem. Um lead aberto em agosto e transferido em setembro conta para
 *   setembro, para quem recebeu — é o que ele teve para trabalhar no mês.
 *
 * CAPTAÇÕES = por CABEÇA e pela IDADE DO IMÓVEL. Imóvel captado em dupla conta
 *   1 inteiro para cada um. E só conta se o imóvel também ENTROU na carteira no
 *   mês (`imoveis.data_cadastro`). Sem essa segunda regra, reatribuição de
 *   carteira vira "captação": em 01/09/2026 um corretor recebeu 56 imóveis num
 *   único dia, cadastrados entre 2022 e 2026, e liderava o ranking sem ter
 *   captado nada.
 *
 * TRANSFERÊNCIA = captador novo em imóvel ANTIGO. Não conta como captação, mas
 *   o Jonatan quer ser avisado quando acontecer — por isso sai em bloco próprio.
 *
 * ATUALIZAÇÕES = campanha "corretor que atualiza imóvel desatualizado ganha a
 *   captação". Fonte: `imovel_atualizacoes` (KSI `atualizacoes`), que registra
 *   quem mexeu em qual imóvel e quando.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'departamentos.json'), 'utf-8')).departamentos;

const arg = process.argv.slice(2).find(a => /^\d{4}-\d{2}$/.test(a));
const MES = arg || new Date().toISOString().slice(0, 7);
const INI = MES + '-01';
const FIM = (() => { const [a, m] = MES.split('-').map(Number);
  return (m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`); })();

const NOME = `COALESCE(
  NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
  NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),''),
  'corretor ' || u.id)`;

const unidade = (depId) => {
  const nome = MAPA[String(depId)];
  if (!nome) return '—';
  const m = nome.match(/^(?:Gerente\s+)?(?:Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  return m ? m[1].trim() : nome;
};

const linha = (i, n, nome, dep) =>
  String(i).padStart(4) + String(n).padStart(7) + '  ' +
  String(nome).slice(0, 40).padEnd(42) + unidade(dep);

(async () => {
  const cob = await pool.query('SELECT max(data_inicio) AS ate FROM leads');
  console.log(`mês ${MES} · dados do Kurole até ${String(cob.rows[0].ate).slice(4, 21)}`);

  // ─── 1. LEADS por atribuição ───
  const leads = await pool.query(`
    SELECT r.corretor_id AS id, ${NOME} AS nome, u.departamento_id AS dep,
           count(DISTINCT r.lead_id) AS n
    FROM lead_responsaveis r JOIN corretores u ON u.id = r.corretor_id
    WHERE r.data >= $1 AND r.data < $2 AND r.corretor_id > 0
    GROUP BY r.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
    ORDER BY n DESC`, [INI, FIM]);
  const totalLeads = leads.rows.reduce((s, x) => s + Number(x.n), 0);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`### LEADS RECEBIDOS — ${totalLeads} leads · ${leads.rows.length} corretores\n`);
  leads.rows.slice(0, 20).forEach((x, i) => console.log(linha(i + 1, x.n, x.nome, x.dep)));
  if (leads.rows.length > 20) console.log(`     … mais ${leads.rows.length - 20} corretores`);

  // ─── 2. CAPTAÇÕES (imóvel também cadastrado no mês) ───
  const capt = await pool.query(`
    SELECT c.corretor_id AS id, ${NOME} AS nome, u.departamento_id AS dep,
           count(DISTINCT c.imovel_id) AS n
    FROM imovel_captadores c
    JOIN corretores u ON u.id = c.corretor_id
    JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.data >= $1 AND c.data < $2 AND c.corretor_id > 0
      AND i.data_cadastro >= $1 AND i.data_cadastro < $2
    GROUP BY c.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
    ORDER BY n DESC`, [INI, FIM]);
  const somaCab = capt.rows.reduce((s, x) => s + Number(x.n), 0);
  const imovDist = await pool.query(`
    SELECT count(DISTINCT c.imovel_id) AS n FROM imovel_captadores c
    JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.data >= $1 AND c.data < $2 AND i.data_cadastro >= $1 AND i.data_cadastro < $2`, [INI, FIM]);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`### CAPTAÇÕES — ${imovDist.rows[0].n} imóveis novos · ${capt.rows.length} corretores\n`);
  capt.rows.slice(0, 20).forEach((x, i) => console.log(linha(i + 1, x.n, x.nome, x.dep)));
  const dupla = somaCab - Number(imovDist.rows[0].n);
  if (dupla > 0) console.log(`\n  soma das cabeças ${somaCab} · imóveis ${imovDist.rows[0].n} · diferença ${dupla} = captação em dupla`);

  /*
   * ─── 3. CAPTADOR NOVO EM IMÓVEL ANTIGO ───
   *
   * Dois fatos diferentes geram o MESMO registro, e só uma coisa os separa:
   * QUEM fez a atualização.
   *   - campanha  → quem atualizou é o próprio corretor que ficou com a captação
   *   - remanejo  → atualizou outra pessoa (ou ninguém)
   *
   * Conferir só "houve atualização perto da data" não serve: em 01/09/2026 os
   * 56 imóveis do Dimas Barbosa tinham atualização, mas foi a Juliana Silva
   * (Administrativo) que fez todas. Ele mesmo atualizou 5 no mês inteiro.
   */
  const transf = await pool.query(`
    SELECT ${NOME} AS nome, u.departamento_id AS dep, c.data::date AS dia,
           count(DISTINCT c.imovel_id) AS n,
           count(DISTINCT c.imovel_id) FILTER (WHERE a.imovel_id IS NOT NULL) AS proprio
    FROM imovel_captadores c
    JOIN corretores u ON u.id = c.corretor_id
    JOIN imoveis i ON i.id = c.imovel_id
    LEFT JOIN imovel_atualizacoes a
      ON a.imovel_id = c.imovel_id
     AND a.corretor_id = c.corretor_id          -- quem atualizou == quem ficou
     AND a.data >= c.data - interval '7 days' AND a.data <= c.data + interval '7 days'
    WHERE c.data >= $1 AND c.data < $2 AND c.corretor_id > 0
      AND i.data_cadastro < $1
    GROUP BY u.nome_comercial, u.nome, u.email, u.id, u.departamento_id, c.data::date
    ORDER BY n DESC`, [INI, FIM]);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`### CAPTADOR NOVO EM IMÓVEL ANTIGO — não conta como captação
`);
  if (!transf.rows.length) console.log('  nenhum no período.');
  const campanha = transf.rows.filter(x => Number(x.proprio) === Number(x.n));
  const remanejo = transf.rows.filter(x => Number(x.proprio) < Number(x.n));
  console.log('  ⚠️ REMANEJAMENTO — atualizado por outra pessoa (ou por ninguém):');
  if (!remanejo.length) console.log('     nenhum.');
  remanejo.slice(0, 12).forEach(x => console.log(
    '     ' + x.dia.toISOString().slice(0, 10) + '  ' + String(x.n).padStart(3) + ' imóveis  ' +
    String(x.nome).slice(0, 34).padEnd(36) + (Number(x.proprio) ? `(${x.proprio} por conta própria)` : '')));
  const nCamp = campanha.reduce((s, x) => s + Number(x.n), 0);
  console.log(`
  ✅ CAMPANHA — o próprio corretor atualizou e ficou com a captação: ${nCamp} imóveis`);
  campanha.slice(0, 10).forEach(x => console.log(
    '     ' + x.dia.toISOString().slice(0, 10) + '  ' + String(x.n).padStart(3) + ' imóveis  ' + String(x.nome).slice(0, 34)));

  // ─── 4. ATUALIZAÇÕES (a campanha) ───
  const atu = await pool.query(`
    SELECT a.corretor_id AS id, ${NOME} AS nome, u.departamento_id AS dep,
           count(DISTINCT a.imovel_id) AS n,
           -- Quantos desses imoveis ele JA captava: separa "cuidar da propria
           -- carteira" de "atualizar imovel dos outros para ganhar a captacao".
           count(DISTINCT a.imovel_id) FILTER (WHERE cap.corretor_id IS NOT NULL) AS proprios
    FROM imovel_atualizacoes a JOIN corretores u ON u.id = a.corretor_id
    LEFT JOIN imovel_captadores cap ON cap.imovel_id = a.imovel_id AND cap.corretor_id = a.corretor_id
    WHERE a.data >= $1 AND a.data < $2 AND a.corretor_id > 0
    GROUP BY a.corretor_id, u.nome_comercial, u.nome, u.email, u.id, u.departamento_id
    ORDER BY n DESC`, [INI, FIM]);
  const totalAtu = atu.rows.reduce((s, x) => s + Number(x.n), 0);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`### IMÓVEIS ATUALIZADOS — ${totalAtu} atualizações · ${atu.rows.length} corretores\n`);
  atu.rows.slice(0, 20).forEach((x, i) => console.log(
    linha(i + 1, x.n, x.nome, x.dep) +
    `   ${x.proprios} da própria carteira · ${Number(x.n) - Number(x.proprios)} de outros`));

  await pool.end();
})().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
