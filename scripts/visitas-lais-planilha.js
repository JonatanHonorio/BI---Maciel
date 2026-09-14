#!/usr/bin/env node
/**
 * Cria (ou atualiza) a planilha "Visitas Lais" no Google Drive, com uma aba por
 * unidade. Fonte: coleta da tela da Lais + corretor/imóvel do Kurole.
 *
 * Uso:
 *   node scripts/visitas-lais-planilha.js <coleta.json> [--ate AAAA-MM-DD] [--id <planilhaId>]
 *
 * Sem --id cria uma planilha nova e compartilha com o Jonatan.
 * Com --id reescreve as abas da planilha existente (mantém a URL).
 *
 * COLUNAS (pedidas pelo Jonatan em 10/09/2026):
 *   Data da visita · Cliente · Telefone · Corretor · Tipo · Referência · Valor · Solicitado em
 *
 * "Data da visita" = o horário MAIS PRÓXIMO entre os que o cliente escolheu.
 * A Lais deixa marcar várias opções e 40 das 95 visitas tinham mais de uma —
 * pegar a primeira do array daria a data errada em boa parte delas, porque a
 * ordem do array não é cronológica (ex.: "16/09 10:00 | 15/09 15:30").
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');
const { getAccessToken, ESCOPO_DRIVE } = require('C:/Users/Jonatan Honório/Documents/Claude/google_conta_servico.js');
const { responsaveisEmLote, escolherOrdem } = require('./kurole-api.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'departamentos.json'), 'utf-8'));
const _CM = JSON.parse(fs.readFileSync(path.join(__dirname, 'correcoes_manuais.json'), 'utf-8'));
const CORRECOES = _CM.correcoes;
const UNIDADE_CORRETOR = _CM.unidade_por_corretor || {};

const S = 'https://sheets.googleapis.com/v4/spreadsheets';
const D = 'https://www.googleapis.com/drive/v3/files';

// ⚠️ Conta da Maciel. NUNCA compartilhar com o e-mail da operação da Laura.
const DONO = 'jonatanhonorio@gmail.com';

const UNIDADES = ['Vista Verde', 'Satélite', 'Aquarius', 'Esplanada', 'Dutra', 'Urbanova'];

const args = process.argv.slice(2);
const arquivo = args.find(a => !a.startsWith('--') && a.endsWith('.json'));
const opcao = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ATE = opcao('ate');
const ID_EXISTENTE = opcao('id');
const XLSX = opcao('xlsx');
// Valvula de escape: se a API do Kurole cair, --sem-api roda so com o dump.
const SEM_API = args.includes('--sem-api');

if (!arquivo) {
  console.error('Uso: node scripts/visitas-lais-planilha.js <coleta.json> [--ate AAAA-MM-DD] [--id <planilhaId>]');
  process.exit(1);
}

const chave = (b) => { const d = String(b || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };

/** "10/09/2026 08:07" -> "2026-09-10 08:07:00" (hora de parede de SP) */
function paraTimestamp(s) {
  const m = String(s || '').match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:00` : null;
}

/** Entre "16/09/2026 10:00|15/09/2026 15:30|..." devolve o mais cedo. */
function maisProxima(v) {
  const itens = String(v || '').split('|').map(x => x.trim()).filter(Boolean);
  if (!itens.length) return { texto: '', ordem: '9999' };
  const ord = itens
    .map(x => ({ texto: x, ordem: paraTimestamp(x) || '9999' }))
    .sort((a, b) => a.ordem < b.ordem ? -1 : 1);
  return ord[0];
}

/** "Locação Vista Verde" -> "Vista Verde" */
function unidadeDoDepartamento(nome) {
  if (!nome) return null;
  const m = nome.match(/^(?:Gerente\s+)?(?:Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// A expressão do regex tem de ser IDÊNTICA à dos índices idx_clientes_celular9 /
// idx_clientes_telefone9 ('\D'), senão o Postgres larga o índice: 0,5s vira 133s.
const SQL = `
  WITH chave AS (SELECT * FROM unnest($1::text[], $2::timestamp[]) AS t(k, ref)),
  cli AS (
    SELECT ch.k, ch.ref, c.id AS cliente_id, c.nome FROM chave ch
    JOIN clientes c ON right(regexp_replace(COALESCE(c.celular,''),'\\D','','g'),9) = ch.k
                    OR right(regexp_replace(COALESCE(c.telefone,''),'\\D','','g'),9) = ch.k),
  ordem AS (
    SELECT DISTINCT ON (cli.k) cli.k, cli.nome AS cliente, l.id AS lead_id
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
  SELECT o.k, o.cliente, ca.departamento_id, ca.id AS corretor_id,
    -- Ultimo recurso: o login do e-mail ("jerson.lima" -> "Jerson Lima").
    COALESCE(
      NULLIF(TRIM(ca.nome_comercial),''),
      NULLIF(TRIM(ca.nome),''),
      NULLIF(initcap(replace(split_part(COALESCE(ca.email,''),'@',1),'.',' ')),'')
    ) AS corretor
  FROM ordem o LEFT JOIN resp ON resp.k = o.k LEFT JOIN corretores ca ON ca.id = resp.atual_id
`;

async function api(url, token, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
  });
  const j = await r.json();
  if (j.error) throw new Error(`${opcoes.method || 'GET'} ${url.slice(0, 70)}… → ${j.error.message}`);
  return j;
}

(async () => {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const visitas = ATE
    ? bruto.filter(v => { const t = paraTimestamp(v.d); return t && t.slice(0, 10) <= ATE; })
    : bruto;
  console.log(`coleta: ${bruto.length} visitas${ATE ? ` · até ${ATE}: ${visitas.length}` : ''}`);

  // ─── Kurole: corretor e unidade ───
  const porTelefone = new Map();
  for (const v of visitas) { const k = chave(v.f); if (k && !porTelefone.has(k)) porTelefone.set(k, v); }
  const chaves = [...porTelefone.keys()];
  const r = await pool.query(SQL, [chaves, chaves.map(k => paraTimestamp(porTelefone.get(k).d))]);
  const kurole = new Map(r.rows.map(x => [x.k, x]));

  /*
   * ─── API do Kurole: corretor AO VIVO ───
   * O dump fica 1 a 3 dias atrás, e quem agendou visita ontem não está nele —
   * era a origem da maioria dos "sem cadastro no Kurole". A API responde o
   * estado de agora, então ela manda; o dump vira rede de segurança.
   * O nome do cliente continua vindo do dump (é só cosmético, e a API de
   * responsáveis não devolve nome de cliente).
   */
  let viaApi = 0, viaDump = 0, apiFalhou = 0;
  if (!SEM_API) {
    process.stdout.write('consultando a API do Kurole (' + chaves.length + ' telefones)… ');
    const { resultados, erros, motivos } = await responsaveisEmLote(
      [...porTelefone.values()].map(v => v.f));
    apiFalhou = erros;
    console.log('pronto' + (erros ? ` (${erros} falharam, caem no dump)` : ''));
    // Mostrar o motivo importa: "limite de uso" pede rodar de novo mais devagar;
    // "escopo" ou "credencial" e problema de configuracao, nao de ritmo.
    if (motivos && motivos.size) {
      for (const [m, n] of motivos) console.log('   motivo (' + n + 'x): ' + m);
    }

    // id_responsavel -> departamento, para a unidade sair igual à do dump.
    const idsResp = new Set();
    for (const lista of resultados.values()) (lista || []).forEach(o => idsResp.add(Number(o.id_responsavel)));
    const deps = idsResp.size
      ? (await pool.query('SELECT id, departamento_id FROM corretores WHERE id = ANY($1::int[])', [[...idsResp]])).rows
      : [];
    const depPorId = new Map(deps.map(x => [String(x.id), x.departamento_id]));

    for (const v of porTelefone.values()) {
      const k = chave(v.f);
      const lista = resultados.get(v.f);
      if (!lista || !lista.length) continue;
      const o = escolherOrdem(lista, v.t === 'buy' ? 'V' : 'L');
      if (!o) continue;
      const anterior = kurole.get(k) || {};

      /*
       * A API PREENCHE LACUNA, não sobrescreve.
       *
       * Ela é mais atual, mas responde de forma instável: o serviço tem limite
       * de uso e, sob rajada, parte das chamadas volta em branco. Deixá-la
       * mandar fazia a MESMA coleta gerar planilhas diferentes a cada rodada
       * (5 e depois 8 visitas fora das abas, em 14/09/2026) — inaceitável num
       * relatório que o gerente usa para cobrar equipe.
       *
       * O dump é uma fotografia completa e estável; a API resolve exatamente o
       * que ele não tem, que é o lead recente. Combinando os dois desse jeito o
       * resultado é reprodutível e a defasagem some do mesmo jeito.
       */
      if (anterior.corretor && unidadeDoDepartamento(MAPA.departamentos[String(anterior.departamento_id)])) {
        continue;
      }
      kurole.set(k, {
        ...anterior,
        k,
        cliente: anterior.cliente || null,
        corretor: o.nome || anterior.corretor || null,
        departamento_id: depPorId.has(String(o.id_responsavel))
          ? depPorId.get(String(o.id_responsavel)) : anterior.departamento_id,
        corretor_id: Number(o.id_responsavel) || anterior.corretor_id,
        _fonte: 'api',
      });
    }
  }

  // ─── Kurole: valor do imóvel (a Ref da Lais é o imoveis.id) ───
  const ids = [...new Set(visitas.map(v => (v.r || '').replace(/^[LV]/i, '')).filter(x => /^\d+$/.test(x)))];
  const im = await pool.query('SELECT id, valor, valor_locacao FROM imoveis WHERE id = ANY($1::int[])', [ids]);
  const imoveis = new Map(im.rows.map(x => [String(x.id), x]));
  console.log(`imóveis encontrados: ${im.rows.length}/${ids.length}`);

  // ─── monta as linhas ───
  const porUnidade = new Map(UNIDADES.map(u => [u, []]));
  const foraDasAbas = [];

  const usadas = [];
  const remanejados = new Set();
  for (const v of visitas) {
    const k = kurole.get(chave(v.f));
    let unidade = k ? unidadeDoDepartamento(MAPA.departamentos[String(k.departamento_id)]) : null;
    let corretor = (k && k.corretor) || null;

    // Cadastro do corretor com unidade errada no Kurole. So troca enquanto o
    // valor calculado ainda for o errado ('de') — corrigido o cadastro, a regra
    // deixa de bater e morre sozinha, sem mascarar o dado verdadeiro.
    if (k && k.corretor_id != null) {
      const uc = UNIDADE_CORRETOR[String(k.corretor_id)];
      if (uc && unidade === uc.de) { unidade = uc.para; remanejados.add(uc.corretor + ': ' + uc.de + ' -> ' + uc.para); }
    }

    // Rede de segurança para ordem aberta DEPOIS do corte do dump: só entra se o
    // automático não resolveu. Com dump mais novo, o dado real ganha sozinho.
    if (!unidade) {
      const c = CORRECOES[chave(v.f)];
      if (c) { unidade = c.unidade; corretor = c.corretor; usadas.push(v.n + ' → ' + c.corretor + ' (' + c.unidade + ')'); }
    }

    const prox = maisProxima(v.v);
    const idImovel = (v.r || '').replace(/^[LV]/i, '');
    const imovel = imoveis.get(idImovel);
    const venda = v.t === 'buy';
    // Venda usa `valor`; locação usa `valor_locacao`. Trocar isso põe o valor de
    // venda de um imóvel na coluna de um aluguel — erro caro e silencioso.
    const valor = imovel ? Number(venda ? imovel.valor : imovel.valor_locacao) || null : null;

    const linha = {
      ordem: prox.ordem,
      celulas: [
        prox.texto,
        (k && k.cliente) || v.n,
        v.f,
        corretor || '(não identificado)',
        venda ? 'Vendas' : 'Locação',
        v.r || '',
        valor,
        v.d,
      ],
    };

    if (k && k.corretor) { if (k._fonte === 'api') viaApi++; else viaDump++; }

    if (unidade && porUnidade.has(unidade)) { porUnidade.get(unidade).push(linha); continue; }

    /*
     * O motivo precisa dizer o que FAZER, não só que falhou. "Corretor fora das
     * unidades" mandava o Jonatan abrir o Kurole para descobrir o obvio: o lead
     * está parado numa caixa administrativa esperando alguém repassar.
     * Andrômeda = onde as recepcionistas do Satélite estão cadastradas; não é
     * unidade comercial e não deve virar aba (confirmado pelo Jonatan 10/09/2026).
     */
    let motivo;
    if (!k) motivo = 'sem cadastro no Kurole';
    else if (!k.corretor) motivo = 'ordem sem responsável';
    else {
      const dep = MAPA.departamentos[String(k.departamento_id)] || 'departamento ' + k.departamento_id;
      motivo = `parado com ${k.corretor} (${dep}) — repassar a um corretor`;
    }
    foraDasAbas.push({ ...linha, motivo });
  }

  for (const [, linhas] of porUnidade) linhas.sort((a, b) => a.ordem < b.ordem ? -1 : 1);

  // Correção manual tem de aparecer SEMPRE: linha preenchida à mão que passa
  // despercebida vira dado "do sistema" e ninguém confere de novo.
  if (remanejados.size) {
    console.log('\nunidade do corretor corrigida à mão (some quando o Kurole for arrumado):');
    [...remanejados].forEach(x => console.log('  ' + x));
  }
  if (usadas.length) {
    console.log('\ncorreções manuais aplicadas (' + usadas.length + ') — saem sozinhas quando o dump alcançar:');
    usadas.forEach(u => console.log('  ' + u));
  }

  // De onde veio cada corretor. Se um dia a API parar de responder, isto avisa
  // antes de a planilha encher de "sem cadastro" sem explicação.
  console.log('\ncorretor veio da API: ' + viaApi + ' · do dump: ' + viaDump +
    (apiFalhou ? ' · a API não respondeu ' + apiFalhou + ' telefone(s)' : ''));

  console.log('\nlinhas por aba:');
  UNIDADES.forEach(u => console.log('  ' + u.padEnd(12) + porUnidade.get(u).length));
  console.log('  fora das abas: ' + foraDasAbas.length);

  const CAB = ['Data da visita', 'Cliente', 'Telefone', 'Corretor responsável',
               'Tipo', 'Referência', 'Valor do imóvel', 'Solicitado em'];

  // ─── saída local (.xlsx) ───
  // A conta de serviço tem cota de Drive ZERO e não consegue CRIAR arquivo —
  // só editar planilha que já existe e foi compartilhada com ela. Este caminho
  // existe para não depender disso.
  if (XLSX) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    for (const u of UNIDADES) {
      const ws = wb.addWorksheet(u);
      ws.addRow(CAB);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      porUnidade.get(u).forEach(l => ws.addRow(l.celulas));
      ws.getColumn(7).numFmt = 'R$ #,##0.00';
      ws.columns.forEach((c, i) => { c.width = [17, 30, 15, 32, 10, 12, 16, 17][i]; });
    }
    if (foraDasAbas.length) {
      const ws = wb.addWorksheet('Sem unidade');
      ws.addRow([...CAB, 'Motivo']);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      foraDasAbas.forEach(l => ws.addRow([...l.celulas, l.motivo]));
      ws.getColumn(7).numFmt = 'R$ #,##0.00';
      ws.columns.forEach((c, i) => { c.width = [17, 30, 15, 32, 10, 12, 16, 17, 26][i]; });
    }

    /*
     * RESUMO — última aba.
     * "Distinta" = telefone + imóvel. Quando o cliente reagenda, a Lais emite
     * notificação nova; contar notificação infla o número. Em set/2026 eram 94
     * notificações para 89 visitas reais.
     * O recorte é o MÊS DA SOLICITAÇÃO, que não é o mesmo conjunto das abas —
     * elas trazem a janela inteira da Lais (~10 dias), que pode pegar o mês
     * anterior. Por isso o cabeçalho diz o período de cada coisa.
     */
    const todas = [...UNIDADES.flatMap(u => porUnidade.get(u)), ...foraDasAbas];
    const mesRef = (() => {
      const meses = [...new Set(todas.map(l => (l.celulas[7] || '').slice(3, 10)))].filter(Boolean).sort(
        (a, b) => (a.slice(3) + a.slice(0, 2)) < (b.slice(3) + b.slice(0, 2)) ? -1 : 1);
      return meses[meses.length - 1] || '';
    })();

    const doMes = (l) => (l.celulas[7] || '').slice(3, 10) === mesRef;
    const distintas = (linhas) => new Set(linhas.filter(doMes).map(l => l.celulas[2] + '|' + l.celulas[5])).size;
    const distintasPorTipo = (linhas, tipo) =>
      new Set(linhas.filter(doMes).filter(l => l.celulas[4] === tipo).map(l => l.celulas[2] + '|' + l.celulas[5])).size;

    const res = wb.addWorksheet('Resumo');
    res.addRow(['Visitas solicitadas em ' + mesRef]);
    res.getRow(1).font = { bold: true, size: 14 };
    res.addRow([]);
    res.addRow(['Unidade', 'Visitas distintas', 'Locação', 'Vendas']);
    res.getRow(3).font = { bold: true };

    let somaU = 0, somaL = 0, somaV = 0;
    for (const u of UNIDADES) {
      const linhas = porUnidade.get(u);
      const d = distintas(linhas), l = distintasPorTipo(linhas, 'Locação'), v = distintasPorTipo(linhas, 'Vendas');
      somaU += d; somaL += l; somaV += v;
      res.addRow([u, d, l, v]);
    }
    const dS = distintas(foraDasAbas);
    res.addRow(['Sem unidade', dS, distintasPorTipo(foraDasAbas, 'Locação'), distintasPorTipo(foraDasAbas, 'Vendas')]);
    const total = res.addRow(['TOTAL', somaU + dS, somaL + distintasPorTipo(foraDasAbas, 'Locação'),
                              somaV + distintasPorTipo(foraDasAbas, 'Vendas')]);
    total.font = { bold: true };

    res.addRow([]);
    res.addRow(['"Distinta" = telefone + imóvel: reagendamento do mesmo cliente no mesmo imóvel conta uma vez.']);
    res.addRow(['As abas por unidade trazem a janela inteira da Lais (~10 dias) e podem incluir o mês anterior.']);
    res.addRow(['Solicitada ≠ realizada: a Lais não informa comparecimento.']);
    res.columns.forEach((c, i) => { c.width = [40, 18, 12, 12][i] || 12; });

    await wb.xlsx.writeFile(XLSX);
    console.log('\narquivo gravado: ' + XLSX);
    await pool.end();
    return;
  }

  // ─── planilha no Google ───
  // A conta de serviço NÃO cria planilha (cota de Drive = 0). O Jonatan cria em
  // branco, compartilha como Editor, e daqui em diante é só reescrever.
  const token = await getAccessToken(false, ESCOPO_DRIVE);

  const id = ID_EXISTENTE;
  if (!id) {
    console.error('\nSem --id não dá: a conta de serviço não consegue criar planilha.');
    console.error('Crie uma em branco, compartilhe como Editor com a conta de serviço e passe --id.');
    process.exit(1);
  }

  /*
   * Diferença deliberada entre as duas saídas (pedido do Jonatan em 10/09/2026):
   * a planilha do Google vai para os GERENTES, e nas abas de unidade o telefone
   * do cliente sai — o corretor responsável já está lá e é por ele que se fala
   * com o cliente. Na aba "Sem unidade" o telefone FICA, porque ali não existe
   * corretor: sem o telefone ninguém consegue agir.
   * O Excel, que é de uso interno do Jonatan, mantém o telefone em tudo.
   */
  const TELEFONE = CAB.indexOf('Telefone');
  const semTelefone = (arr) => arr.filter((_, i) => i !== TELEFONE);

  const ABAS = [
    ...UNIDADES.map(u => ({
      titulo: u,
      cab: semTelefone(CAB),
      linhas: porUnidade.get(u).map(l => semTelefone(l.celulas)),
    })),
    { titulo: 'Sem unidade', cab: [...CAB, 'Motivo'], linhas: foraDasAbas.map(l => [...l.celulas, l.motivo]) },
  ];

  let meta = await api(`${S}/${id}?fields=sheets(properties(sheetId,title,gridProperties))`, token);
  let existentes = new Map(meta.sheets.map(s => [s.properties.title, s.properties]));

  // Planilha nova do Google vem com uma aba solitária ("Página1"/"Sheet1").
  // Renomear é melhor que criar sete e apagar a órfã: não deixa lixo e não
  // depende de apagar nada do que é dele.
  const criacoes = [];
  if (meta.sheets.length === 1 && !ABAS.some(a => a.titulo === meta.sheets[0].properties.title)) {
    criacoes.push({ updateSheetProperties: {
      properties: { sheetId: meta.sheets[0].properties.sheetId, title: ABAS[0].titulo, gridProperties: { frozenRowCount: 1 } },
      fields: 'title,gridProperties.frozenRowCount' } });
    existentes.set(ABAS[0].titulo, meta.sheets[0].properties);
  }
  for (const a of ABAS) {
    if (existentes.has(a.titulo)) continue;
    criacoes.push({ addSheet: { properties: { title: a.titulo, gridProperties: { frozenRowCount: 1 } } } });
  }
  if (criacoes.length) {
    await api(`${S}/${id}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests: criacoes }) });
    console.log(`\nabas ajustadas: ${criacoes.length}`);
  }

  // Limpa antes de escrever: sem isso, uma rodada com menos linhas que a anterior
  // deixaria visitas velhas penduradas embaixo, parecendo agendamentos atuais.
  await api(`${S}/${id}/values:batchClear`, token, {
    method: 'POST',
    body: JSON.stringify({ ranges: ABAS.map(a => `'${a.titulo}'!A1:Z2000`) }),
  });

  await api(`${S}/${id}/values:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: ABAS.map(a => ({ range: `'${a.titulo}'!A1`, values: [a.cab, ...a.linhas] })),
    }),
  });

  // ─── formatação ───
  meta = await api(`${S}/${id}?fields=sheets(properties(sheetId,title))`, token);
  const idDaAba = new Map(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const pedidos = [];
  for (const a of ABAS) {
    const sid = idDaAba.get(a.titulo);
    if (sid === undefined) continue;
    pedidos.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.92, green: 0.92, blue: 0.92 } } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });
    // A coluna de valor muda de posição entre as abas (as de unidade não têm
    // Telefone), então sai do cabeçalho — número fixo aqui formataria a coluna
    // errada e o valor apareceria como texto solto.
    const cValor = a.cab.indexOf('Valor do imóvel');
    if (cValor >= 0) pedidos.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 1, startColumnIndex: cValor, endColumnIndex: cValor + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
    pedidos.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: a.cab.length } } });
  }
  await api(`${S}/${id}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests: pedidos }) });

  console.log('\nhttps://docs.google.com/spreadsheets/d/' + id);
  if (foraDasAbas.length) {
    console.log('\nNÃO entraram em nenhuma aba (' + foraDasAbas.length + '):');
    foraDasAbas.forEach(l => console.log('  ' + l.celulas[0] + '  ' + l.celulas[1] + ' / ' + l.celulas[2] + ' — ' + l.motivo));
  }

  await pool.end();
})().catch(e => { console.error('\nERRO: ' + e.message); process.exit(1); });
