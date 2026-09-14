/**
 * Cliente da API do Kurole (KSI). Documentação em Documents/Maciel/API/*.pdf.
 *
 * Tudo passa pelo MESMO caminho `escopos/`; quem escolhe o serviço é o
 * parâmetro `ws_destino`. Autenticação: Authorization: Bearer <chave>.
 * Chave na query string NÃO funciona.
 *
 * Por que isto existe: o dump do KSI fica ~1 a 3 dias atrás do presente, e o
 * lead que agendou visita ontem simplesmente não está nele. Toda a categoria
 * "sem cadastro no Kurole" dos relatórios de visita era, na maioria, defasagem.
 * A API responde ao vivo.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const CHAVE = process.env.KUROLE_API_KEY;
const BASE = process.env.KUROLE_API_BASE;
const ID = process.env.KUROLE_API_ID;

function conferirConfig() {
  if (!CHAVE || !BASE || !ID) {
    throw new Error('Faltam KUROLE_API_KEY / KUROLE_API_BASE / KUROLE_API_ID no .env.local');
  }
}

/** A API exige o telefone formatado: (12) 98842-6810 ou (12) 3421-1234. */
function formatarTelefone(bruto) {
  const d = String(bruto || '').replace(/\D/g, '').slice(-11);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

async function chamar(destino, params = {}) {
  conferirConfig();
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${BASE}/escopos/?id=${ID}&ws_destino=${destino}${qs ? '&' + qs : ''}`;

  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + CHAVE } });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); }
  catch { throw new Error(`${destino}: resposta não-JSON (${txt.replace(/\s+/g, ' ').slice(0, 120)})`); }
  const bloco = Array.isArray(j) ? j[0] : j;
  if (!bloco) return [];
  if (String(bloco.sucesso) === '1') {
    // A API às vezes devolve dados:[""] — uma string vazia no lugar do objeto.
    return (bloco.dados || []).filter(x => x && typeof x === 'object');
  }

  /*
   * "sucesso 0" tem DOIS significados e confundi-los é perigoso:
   *   - "Ordem de atendimento nao encontrada" → resposta legítima, o telefone
   *     realmente não tem ordem. Devolver vazio está certo.
   *   - qualquer outra mensagem → falha (credencial, escopo, servidor). Se isso
   *     virar vazio, a visita cai em "sem cadastro no Kurole" e o relatório
   *     acusa um problema que não existe, escondendo o que existe.
   */
  const msg = String(bloco.msg || '');
  if (/n[ãa]o encontrad/i.test(msg)) return [];
  throw new Error(`${destino}: ${msg || 'falha sem mensagem'}`);
}

/**
 * Responsáveis das ordens de um telefone. Devolve TODAS as ordens, inclusive
 * fechadas e antigas — a escolha fica com quem chama.
 */
async function responsaveisPorTelefone(telefone) {
  const fone = formatarTelefone(telefone);
  if (!fone) return [];
  return chamar('ORDEM_ATENDIMENTO_RESPONSAVEIS', { oa_telefone: fone });
}

/**
 * Escolhe UMA ordem entre as devolvidas.
 *
 * Ordem de preferência, nesta sequência:
 *   1. ordem ABERTA — é quem está atendendo agora;
 *   2. operação igual à da visita (L para locação, V para venda) — o mesmo
 *      cliente pode ter uma ordem de compra e outra de aluguel ao mesmo tempo,
 *      e mandar a visita de aluguel para o corretor de vendas erra a pessoa;
 *   3. maior id — os ids são sequenciais, então o maior é o mais recente.
 *
 * Sem data na resposta da API, "maior id" é o melhor sinal de recência que há.
 */
function escolherOrdem(ordens, operacao) {
  if (!ordens || !ordens.length) return null;
  const pontos = (o) => {
    let p = 0;
    if (String(o.situcao || '').toUpperCase() === 'ABERTA') p += 100;
    if (operacao && String(o.operacao || '').toUpperCase() === operacao.toUpperCase()) p += 10;
    return p;
  };
  return [...ordens].sort((a, b) => {
    const d = pontos(b) - pontos(a);
    if (d) return d;
    return Number(b.id_ordem_atendimento || 0) - Number(a.id_ordem_atendimento || 0);
  })[0];
}

/**
 * Consulta em lote com concorrência limitada. São ~120 telefones por rodada;
 * disparar tudo de uma vez é abusar do servidor deles sem necessidade.
 */
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Consulta em lote, devagar de propósito.
 *
 * ⚠️ A API TEM LIMITE DE USO. Medido em 14/09/2026: com concorrência 6 e 123
 * telefones em rajada, **119 falharam**; as mesmas chamadas, espaçadas, passam
 * todas. O limite não se anuncia — a chamada volta com falha genérica, e foi só
 * porque o cliente parou de tratar erro como "sem ordem" que isso apareceu.
 *
 * Por isso: 2 de cada vez, pausa entre elas, e três tentativas com espera
 * crescente. Fica mais lento (~1 min para 120 telefones) e vale a pena: falha
 * silenciosa aqui empurra visita para "sem cadastro" e some com gente do mapa.
 */
async function responsaveisEmLote(telefones, {
  concorrencia = 2, pausaMs = 120, tentativas = 3, aoProgredir,
} = {}) {
  const saida = new Map();
  const fila = [...new Set(telefones.filter(Boolean))];
  const motivos = new Map();
  let i = 0, erros = 0;

  async function trabalhador() {
    while (i < fila.length) {
      const t = fila[i++];
      let ok = false;
      for (let tentativa = 1; tentativa <= tentativas && !ok; tentativa++) {
        try {
          saida.set(t, await responsaveisPorTelefone(t));
          ok = true;
        } catch (e) {
          if (tentativa === tentativas) {
            erros++;
            saida.set(t, null); // null = falhou de vez; [] = respondeu "sem ordem"
            const m = String(e.message).slice(0, 90);
            motivos.set(m, (motivos.get(m) || 0) + 1);
          } else {
            await dormir(400 * tentativa); // recuo crescente
          }
        }
      }
      if (aoProgredir) aoProgredir(saida.size, fila.length);
      await dormir(pausaMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, fila.length) }, trabalhador));
  return { resultados: saida, erros, motivos };
}

module.exports = {
  chamar, formatarTelefone, responsaveisPorTelefone, responsaveisEmLote, escolherOrdem,
};
