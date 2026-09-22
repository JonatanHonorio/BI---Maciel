import fs from "fs";
import path from "path";
import type { SQL } from "./db";

export const UNIDADES_FECHAMENTO = [
  "Satélite", "Vista Verde", "Urbanova", "Aquarius", "Esplanada", "Dutra",
  "Diretoria", "Lançamento",
] as const;

export const ORIGENS_FECHAMENTO = [
  "Cliente de Carteira", "Plantão de Vendas", "Canal Pro", "Indicação", "Site",
  "Placa", "OLX", "ZAP", "VivaReal", "ImovelWeb", "Fachada da Imobiliária",
  "V4", "Facebook", "Instagram", "Panfletos", "Status/Story",
] as const;

export const PAGAMENTOS_FECHAMENTO = [
  "Financiamento", "A Vista", "Fgts", "Consórcio", "Parcelado",
] as const;

// "Captação" chegou a existir como terceiro papel (18/09/2026) e saiu no mesmo
// dia: o Jonatan avisou que captação e levantamento são a mesma coisa.
//
// Os papéis e os percentuais moram em `@/lib/comissao`, que não importa nada
// e por isso pode ser usado também pelo formulário (client component). Aqui
// só reexporto pra não haver duas listas de papéis se desencontrando.
export { PAPEIS_RATEIO, ehRubrica, type Papel } from "./comissao";
import { PAPEIS_RATEIO as PAPEIS, ehRubrica as _ehRubrica } from "./comissao";
import type { Papel as _Papel } from "./comissao";

export interface RateioEntrada {
  corretor_id?: number | string | null;
  nome_livre?: string | null;
  papel: _Papel;
  percentual?: number | null;
}

/**
 * Valida uma linha de rateio e devolve os dois campos de destinatário já
 * normalizados, ou `null` se a linha não serve.
 *
 * Uma linha precisa apontar para ALGUÉM: um corretor do Kurole ou, enquanto
 * `PERMITE_NOME_LIVRE_NO_RATEIO` estiver ligada, um nome digitado. Quando os
 * dois vêm preenchidos, o corretor do Kurole ganha — é o que liga a comissão
 * a um cadastro de verdade, e o texto seria só o rótulo que a pessoa viu na
 * tela.
 *
 * A mesma função serve o POST e o PUT pra que as duas portas de escrita não
 * divirjam: já aconteceu de uma aceitar o que a outra recusava.
 */
export function normalizaLinhaRateio(
  r: RateioEntrada,
  permiteNomeLivre: boolean
): { corretor_id: number | null; nome_livre: string | null } | null {
  if (!PAPEIS.includes(r.papel)) return null;
  // Rubrica (Diretoria) não tem pessoa: o destinatário é o próprio rótulo.
  // Não depende da chave de nome livre, que é temporária — rubrica é regra
  // permanente do negócio.
  if (_ehRubrica(r.papel)) {
    const rotulo = (r.nome_livre ?? "").trim();
    return rotulo ? { corretor_id: null, nome_livre: rotulo } : null;
  }
  const id = Number(r.corretor_id);
  if (Number.isFinite(id) && id > 0) return { corretor_id: id, nome_livre: null };
  const nome = (r.nome_livre ?? "").trim();
  if (permiteNomeLivre && nome) return { corretor_id: null, nome_livre: nome };
  return null;
}

/** Primeiro dia do mês corrente, formato YYYY-MM-DD (pra coluna DATE). */
export function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

interface CorretorFechamento {
  id: number;
  nome: string;
}

let listaCache: CorretorFechamento[] | null = null;

/** scripts/corretores_fechamento.json — ver o _comentario de lá. */
function listaCorretoresFechamento(): CorretorFechamento[] {
  if (listaCache) return listaCache;
  try {
    const p = path.join(process.cwd(), "scripts", "corretores_fechamento.json");
    // O arquivo tem linhas de comentário ({_grupo: "..."}) no meio da lista.
    listaCache = (JSON.parse(fs.readFileSync(p, "utf-8")).corretores as CorretorFechamento[])
      .filter((c) => typeof c?.id === "number");
  } catch {
    listaCache = [];
  }
  return listaCache!;
}

/** "jerson.lima@..." -> "Jerson Lima" (pra quem está sem nome no Kurole). */
function nomePeloEmail(email: string | null): string {
  return (email || "")
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Quem pode receber rateio de comissão. A MESMA lista pra todas as unidades —
 * confirmado com o Jonatan em 18/09/2026: as unidades são parceiras, vendem
 * captação uma da outra, corretores dividem venda entre si e corretor de
 * locação faz venda de vez em quando. Também é o que destrava Diretoria e
 * Lançamento, que não têm departamento próprio no Kurole e por isso traziam
 * só a Secretaria Comercial.
 *
 * Não é "todo corretor ativo" (são 202, a maioria não fecha negócio): a lista
 * sai das roletas de Leads Online, em scripts/corretores_fechamento.json.
 */
export async function corretoresParaRateio(sql: SQL): Promise<CorretorFechamento[]> {
  const lista = listaCorretoresFechamento();
  if (!lista.length) return [];

  const ids = lista.map((c) => c.id);
  const rows = (await sql`
    SELECT id, email,
      COALESCE(NULLIF(TRIM(nome_comercial), ''), NULLIF(TRIM(nome), '')) AS nome
    FROM corretores WHERE id = ANY(${ids}::int[])
  `) as { id: number; email: string | null; nome: string | null }[];

  const doBanco = new Map(rows.map((r) => [r.id, r]));
  return lista
    .map((c) => {
      const r = doBanco.get(c.id);
      // Nome do cadastro manda; vazio cai pro e-mail; sem e-mail, o do JSON.
      return { id: c.id, nome: r?.nome || nomePeloEmail(r?.email ?? null) || c.nome };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * O gerente da unidade/vertical, como CORRETOR — é ele que entra no bloco
 * Gerência do rateio e recebe os 10%.
 *
 * A ponte entre as duas tabelas é o e-mail: `usuarios_bi` guarda quem é
 * gerente de quê, e `corretores` guarda o cadastro que recebe comissão. Os 12
 * gerentes casam pelos dois lados (conferido em 21/09/2026).
 *
 * Devolve null em Diretoria e Lançamento, que não têm gerente próprio — nesses
 * o bloco fica vazio pra adm preencher.
 */
export async function gerenteDaUnidade(
  sql: SQL, unidade: string | null, tipo: string | null
): Promise<CorretorFechamento | null> {
  if (!unidade || !tipo) return null;
  const [row] = (await sql`
    SELECT c.id,
      COALESCE(NULLIF(TRIM(c.nome_comercial), ''), NULLIF(TRIM(c.nome), '')) AS nome
    FROM usuarios_bi u
    JOIN corretores c ON lower(c.email) = lower(u.email)
    WHERE u.role = 'gerente' AND u.ativo = true
      AND u.unidade = ${unidade} AND u.tipo = ${tipo}
    LIMIT 1
  `) as { id: number; nome: string | null }[];
  return row?.id ? { id: Number(row.id), nome: row.nome || `corretor ${row.id}` } : null;
}

/**
 * Cruza a unidade PEDIDA no filtro com as que a pessoa PODE ver.
 *
 * Nunca amplia: a gerente administrativa que mandar `unidade=Aquarius` na URL
 * recebe lista vazia, não o fechamento da Aquarius. `permitidas` nulo é o
 * admin, que vê todas — aí o filtro vale sozinho.
 */
export function escopoUnidade(
  permitidas: string[] | null, pedida: string | null
): string[] | null {
  if (!pedida) return permitidas;
  if (permitidas === null) return [pedida];
  return permitidas.includes(pedida) ? [pedida] : [];
}

export interface RateioDoMes {
  id: number;
  corretor_id: number | null;
  nome: string;
  papel: string;
  percentual: number | null;
  pagamentos: { id: number; valor: number; data_pagamento: string; observacao: string | null }[];
}

export interface NegocioDoMes {
  id: number; ref: string | null; endereco: string | null;
  valor: number | null; comissao: number | null;
  unidade: string; tipo: "venda" | "locacao"; competencia: string;
  rateio: RateioDoMes[];
}

/**
 * Negócios de uma FAIXA de competências, com rateio e pagamentos, já escopados
 * pelas unidades/tipos que a pessoa pode ver.
 *
 * Faixa, e não mês único, porque a diretoria precisa perguntar coisas que
 * atravessam meses: o que falta pagar no ano, quanto um corretor recebeu num
 * período. `de` e `ate` são inclusivos e podem ser o mesmo mês.
 *
 * Fica aqui, e não solto em cada rota, porque a tela de Comissões e a
 * exportação em Excel precisam do MESMO resultado. Quando a consulta estava
 * duplicada, uma delas ficou mostrando `nome_comercial` puro enquanto a outra
 * já caía pro `nome` — e a mesma pessoa aparecia com nome numa tela e em
 * branco na outra.
 *
 * `unidades`/`tipos` nulos significam "todas" (admin).
 */
export async function negociosDaCompetencia(
  sql: SQL, de: string, ate: string, unidades: string[] | null, tipos: string[] | null
): Promise<NegocioDoMes[]> {
  const todasUnidades = unidades === null;
  const todosTipos = tipos === null;
  return (await sql`
    SELECT n.id, n.ref, n.endereco, n.valor, n.comissao,
      p.unidade, p.tipo, p.competencia,
      COALESCE(
        json_agg(
          json_build_object(
            'id', rc.id, 'corretor_id', rc.corretor_id,
            'nome', COALESCE(NULLIF(TRIM(cor.nome_comercial), ''), NULLIF(TRIM(cor.nome), ''), rc.nome_livre),
            'papel', rc.papel, 'percentual', rc.percentual,
            'pagamentos', COALESCE(pg.pagamentos, '[]'::json)
          ) ORDER BY rc.papel, rc.id
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'id', fp.id, 'valor', fp.valor, 'data_pagamento', fp.data_pagamento, 'observacao', fp.observacao
      ) ORDER BY fp.data_pagamento) AS pagamentos
      FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id
    ) pg ON true
    WHERE p.competencia BETWEEN ${de} AND ${ate}
      AND (${todasUnidades} OR p.unidade = ANY(${unidades ?? []}::text[]))
      AND (${todosTipos} OR p.tipo = ANY(${tipos ?? []}::text[]))
    GROUP BY n.id, p.unidade, p.tipo, p.competencia
    ORDER BY p.competencia, p.unidade, p.tipo, n.id
  `) as NegocioDoMes[];
}

export interface RateioPagamento {
  percentual: number | string | null;
  pagamentos: { valor: number | string }[];
}

export interface RateioComputado<T extends RateioPagamento> {
  linha: T;
  valorDevido: number | null;
  valorPago: number;
}

export interface StatusPagamentoNegocio<T extends RateioPagamento> {
  pool: number;
  rateio: RateioComputado<T>[];
  valorDevidoTotal: number;
  valorPagoTotal: number;
  ficouParaImobiliaria: number;
  status: "pendente" | "parcial" | "pago";
}

/**
 * Cruza o rateio de um negócio com o histórico de pagamentos e devolve
 * quanto cada destinatário devia/já recebeu, quanto ficou com a
 * imobiliária e o status geral do negócio — usado tanto na tela de
 * Comissões quanto na exportação de Excel, pra não duplicar a regra.
 * `pool` é a comissão (venda) ou o valor da prestação de serviço (locação);
 * linha com percentual nulo não entra no devido total (aparece como "—").
 */
export function calcularStatusPagamento<T extends RateioPagamento>(
  pool: number | string | null,
  rateio: T[]
): StatusPagamentoNegocio<T> {
  const poolNum = pool != null ? Number(pool) : 0;
  let valorDevidoTotal = 0;
  let valorPagoTotal = 0;
  const linhas = rateio.map((linha) => {
    const valorDevido = linha.percentual != null ? Number(linha.percentual) * poolNum : null;
    const valorPago = linha.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
    if (valorDevido != null) valorDevidoTotal += valorDevido;
    valorPagoTotal += valorPago;
    return { linha, valorDevido, valorPago };
  });
  const status: StatusPagamentoNegocio<T>["status"] =
    valorPagoTotal <= 0
      ? "pendente"
      : valorDevidoTotal > 0 && valorPagoTotal >= valorDevidoTotal
        ? "pago"
        : "parcial";
  return {
    pool: poolNum,
    rateio: linhas,
    valorDevidoTotal,
    valorPagoTotal,
    ficouParaImobiliaria: poolNum - valorDevidoTotal,
    status,
  };
}
