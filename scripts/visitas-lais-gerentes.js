#!/usr/bin/env node
/**
 * Relatório de visitas agendadas pela Lais, separado por unidade, para avisar
 * os gerentes. Roda às terças (período até domingo) e às sextas (até quarta).
 *
 * Uso:
 *   node scripts/visitas-lais-gerentes.js <coleta.json> --ate 2026-09-06 [--de 2026-09-03]
 *
 * O <coleta.json> vem da tela da Lais (casa.lais.ai/notifications) — ver o
 * passo 1 da skill `visitas-lais`. Formato de cada item:
 *   { n: nome, f: telefone, d: "dd/mm/aaaa HH:MM", r: "L58235", t: "rent"|"buy",
 *     v: "dd/mm/aaaa HH:MM|..." }
 *
 * --- POR QUE A UNIDADE VEM DO CORRETOR ---
 * Não use `leads.empresa_id`: ele marca onde a ORDEM foi aberta, e como a Lais
 * atende pelo WhatsApp central quase tudo nasce na empresa 1 (95% da amostra de
 * set/2026, contra 61% da base inteira). O gerente precisa saber das visitas que
 * a EQUIPE DELE vai fazer, então a unidade sai do departamento do corretor
 * responsável (`corretores.departamento_id` → scripts/departamentos.json).
 *
 * --- DEFASAGEM DO DUMP ---
 * O dump do KSI fica ~1,5 dia atrás do presente: o arquivo gerado na quinta
 * 10/09/2026 11:47 continha leads só até 08/09. A cadência terça/sexta com corte
 * em domingo/quarta absorve essa defasagem. Antecipar o corte quebra isso — o
 * script avisa quando o corte passa da cobertura do banco.
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'departamentos.json'), 'utf-8'));
// Mesmas correcoes usadas pela planilha: as duas saidas TEM de concordar, senao
// o gerente recebe uma lista que nao bate com a planilha e ninguem sabe qual vale.
const _CM = JSON.parse(fs.readFileSync(path.join(__dirname, 'correcoes_manuais.json'), 'utf-8'));
const CORRECOES = _CM.correcoes;
const UNIDADE_CORRETOR = _CM.unidade_por_corretor || {};

const args = process.argv.slice(2);
const arquivo = args.find(a => !a.startsWith('--'));
const opcao = (nome) => { const i = args.indexOf('--' + nome); return i >= 0 ? args[i + 1] : null; };
const ATE = opcao('ate');
const DE = opcao('de');
// --visita muda a pergunta: em vez de "o que foi SOLICITADO no periodo", responde
// "quem tem VISITA neste dia" — que e a lista que o gerente usa para cobrar a agenda.
const DIA_VISITA = opcao('visita');

if (!arquivo || (!ATE && !DIA_VISITA)) {
  console.error('Uso: node scripts/visitas-lais-gerentes.js <coleta.json> --ate AAAA-MM-DD [--de AAAA-MM-DD]');
  console.error('     node scripts/visitas-lais-gerentes.js <coleta.json> --visita AAAA-MM-DD');
  process.exit(1);
}

/** "AAAA-MM-DD" -> "DD/MM/AAAA", que e como a Lais grava os horarios. */
const paraBR = (iso) => iso.split('-').reverse().join('/');

/** Horarios propostos, do mais cedo para o mais tarde. */
function horariosOrdenados(v) {
  const ord = (s) => { const m = String(s).match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/); return m ? m[3] + m[2] + m[1] + m[4] + m[5] : '9'.repeat(12); };
  return String(v.v || '').split('|').map(s => s.trim()).filter(Boolean)
    .sort((a, b) => ord(a) < ord(b) ? -1 : 1);
}

/** "Locação Vista Verde" -> { unidade: "Vista Verde", vertical: "Locação" } */
function separarDepartamento(nome) {
  if (!nome) return null;
  const m = nome.match(/^(Gerente\s+)?(Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  if (!m) return null;
  const vertical = /loca/i.test(m[2]) ? 'Locação' : 'Vendas';
  return { unidade: m[3].trim(), vertical, gerente: !!m[1] };
}

const chave = (b) => { const d = String(b || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };

// "10/09/2026 08:07" -> "2026-09-10 08:07:00" (hora de parede de SP)
function paraTimestamp(s) {
  const m = String(s || '').match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:00` : null;
}
const paraData = (s) => { const t = paraTimestamp(s); return t ? t.slice(0, 10) : null; };

// A expressão do regex tem de ser IDÊNTICA à dos índices idx_clientes_celular9 /
// idx_clientes_telefone9 ('\D'). Trocar por '[^0-9]' descarta o índice: 2s vira 133s.
const SQL = `
  WITH chave AS (SELECT * FROM unnest($1::text[], $2::timestamp[]) AS t(k, ref)),
  cli AS (
    SELECT ch.k, ch.ref, c.id AS cliente_id, c.nome FROM chave ch
    JOIN clientes c ON right(regexp_replace(COALESCE(c.celular,''),'\\D','','g'),9) = ch.k
                    OR right(regexp_replace(COALESCE(c.telefone,''),'\\D','','g'),9) = ch.k),
  ordem AS (
    SELECT DISTINCT ON (cli.k) cli.k, cli.nome AS cliente, l.id AS lead_id, l.data_inicio
    FROM cli JOIN leads l ON l.cliente_id = cli.cliente_id
    ORDER BY cli.k,
      CASE WHEN cli.ref IS NULL THEN NULL ELSE abs(extract(epoch FROM l.data_inicio - cli.ref)) END ASC NULLS LAST,
      l.data_inicio DESC NULLS LAST, l.id DESC),
  resp AS (
    SELECT o.k, (ARRAY_AGG(r.corretor_id ORDER BY r.data DESC NULLS LAST, r.id DESC))[1] AS atual_id
    FROM ordem o JOIN lead_responsaveis r ON r.lead_id = o.lead_id
    JOIN corretores c ON c.id = r.corretor_id
    -- NAO filtrar por nome preenchido: corretor real pode estar com nome vazio
    -- no cadastro (jerson.lima, id 157, Locacao Dutra). Filtrar aqui fazia a
    -- ordem parecer SEM RESPONSAVEL e a visita cair fora da aba da unidade.
    WHERE r.corretor_id > 0
    GROUP BY o.k)
  SELECT o.k, o.cliente, o.lead_id,
    ca.id AS corretor_id, ca.departamento_id, ca.celular AS corretor_celular,
    -- Ultimo recurso: o login do e-mail ("jerson.lima" -> "Jerson Lima").
    COALESCE(
      NULLIF(TRIM(ca.nome_comercial),''),
      NULLIF(TRIM(ca.nome),''),
      NULLIF(initcap(replace(split_part(COALESCE(ca.email,''),'@',1),'.',' ')),'')
    ) AS corretor
  FROM ordem o LEFT JOIN resp ON resp.k = o.k LEFT JOIN corretores ca ON ca.id = resp.atual_id
`;

(async () => {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));

  let visitas;
  if (DIA_VISITA) {
    // O cliente pode marcar varias opcoes e a Lais nao diz qual foi confirmada.
    // A lista usa o horario MAIS CEDO (leitura conservadora); quem so tem o dia
    // como 2a/3a opcao aparece separado no fim, para o gerente decidir.
    const alvo = paraBR(DIA_VISITA);
    visitas = bruto.filter(v => (horariosOrdenados(v)[0] || '').startsWith(alvo));
    const alternativa = bruto.filter(v => !(horariosOrdenados(v)[0] || '').startsWith(alvo)
      && horariosOrdenados(v).some(h => h.startsWith(alvo)));
    console.log(`VISITAS DE ${alvo}: ${visitas.length}` +
      (alternativa.length ? ` (mais ${alternativa.length} que propuseram esse dia como alternativa)` : '') + '\n');
    global.__alternativa = alternativa;
  } else {
    // Recorte do período pela data em que a visita foi AGENDADA (notificação).
    visitas = bruto.filter(v => {
      const d = paraData(v.d);
      return d && d <= ATE && (!DE || d >= DE);
    });
    console.log(`coleta: ${bruto.length} visitas · período ${DE || 'início'} a ${ATE}: ${visitas.length}\n`);
  }
  if (!visitas.length) { console.log('nada no período.'); await pool.end(); return; }

  // O dump cobre o período pedido?
  const cob = await pool.query('SELECT max(data_inicio)::date AS ate FROM leads');
  const cobertura = cob.rows[0].ate.toISOString().slice(0, 10);
  if (ATE && cobertura < ATE) {
    console.log(`⚠️  O banco tem leads só até ${cobertura}, e você pediu até ${ATE}.`);
    console.log('    As visitas depois dessa data vão sair sem corretor. Importe um dump mais novo.\n');
  }

  const mapa = new Map();
  for (const v of visitas) { const k = chave(v.f); if (k && !mapa.has(k)) mapa.set(k, v); }
  const chaves = [...mapa.keys()];
  const r = await pool.query(SQL, [chaves, chaves.map(k => paraTimestamp(mapa.get(k).d))]);
  const porChave = new Map(r.rows.map(x => [x.k, x]));

  // Agrupa por unidade do corretor.
  const unidades = new Map();
  const semUnidade = [];
  const desconhecidos = new Set();

  for (const v of visitas) {
    const x = porChave.get(chave(v.f));
    const dep = x && x.departamento_id != null ? MAPA.departamentos[String(x.departamento_id)] : null;
    let sep = separarDepartamento(dep);
    let corrigido = null;
    // Cadastro do corretor com unidade errada: so troca enquanto o valor ainda
    // for o errado ('de'); arrumado o Kurole, a regra deixa de bater e morre.
    if (sep && x && x.corretor_id != null) {
      const uc = UNIDADE_CORRETOR[String(x.corretor_id)];
      if (uc && sep.unidade === uc.de) sep = { ...sep, unidade: uc.para };
    }
    if (!sep) {
      const c = CORRECOES[chave(v.f)];
      if (c) { sep = { unidade: c.unidade, vertical: null }; corrigido = c.corretor; }
    }
    if (x && x.departamento_id != null && dep && !sep) desconhecidos.add(dep);

    const item = {
      cliente: (x && x.cliente) || v.n,
      telefone: v.f,
      corretor: (x && x.corretor) || corrigido || null,
      imovel: v.r || '(sem ref)',
      tipo: v.t === 'buy' ? 'Venda' : 'Locação',
      agendadoEm: v.d,
      // Ordenado: o gerente le o primeiro horario. Fora de ordem, uma visita de
      // amanha que comeca listando depois de amanha parece nao ser de amanha.
      visitas: horariosOrdenados(v),
      // Diz o que fazer, nao so que falhou: lead parado em caixa administrativa
      // (ex.: Andromeda = recepcao do Satelite) precisa ser repassado, nao investigado.
      motivo: !x ? 'sem cadastro no Kurole'
        : (!x.corretor ? 'ordem sem responsável'
        : `parado com ${x.corretor} (${dep || 'sem departamento'}) — repassar a um corretor`),
    };

    if (!sep) { semUnidade.push(item); continue; }
    const nome = sep.unidade;
    if (!unidades.has(nome)) unidades.set(nome, []);
    unidades.get(nome).push(item);
  }

  const total = visitas.length;
  const atribuidas = total - semUnidade.length;
  console.log(`identificadas com unidade: ${atribuidas}/${total} (${(atribuidas / total * 100).toFixed(1)}%)`);
  console.log('='.repeat(64));

  for (const [unidade, itens] of [...unidades.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const v = itens.filter(i => i.tipo === 'Venda').length;
    const l = itens.length - v;
    console.log(`\n### ${unidade.toUpperCase()} — ${itens.length} visita(s) agendada(s)  (${l} locação, ${v} venda)\n`);
    const hora = (i) => { const m = (i.visitas[0] || '').match(/(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/); return m ? m[3]+m[2]+m[1]+m[4]+m[5] : '9'.repeat(12); };
    itens.sort((a, b) => hora(a) < hora(b) ? -1 : 1);
    for (const i of itens) {
      console.log(`• ${i.cliente} — ${i.telefone}`);
      console.log(`  imóvel ${i.imovel} (${i.tipo}) · corretor: ${i.corretor}`);
      console.log(`  visita: ${i.visitas.join('  ou  ') || '(sem horário)'}`);
    }
  }

  if (semUnidade.length) {
    console.log(`\n${'='.repeat(64)}`);
    console.log(`\n### SEM UNIDADE — ${semUnidade.length} visita(s), precisam de olho\n`);
    for (const i of semUnidade) {
      console.log(`• ${i.cliente} — ${i.telefone} · imóvel ${i.imovel} (${i.tipo})`);
      console.log(`  visita: ${i.visitas.join('  ou  ') || '(sem horário)'} · ${i.motivo || 'corretor sem departamento de unidade'}`);
    }
  }

  if (desconhecidos.size) {
    console.log('\n⚠️  departamentos que não casam com "Locação X"/"Vendas X": ' + [...desconhecidos].join(', '));
    console.log('    (se for unidade nova, ajustar separarDepartamento ou departamentos.json)');
  }

  await pool.end();
})().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
