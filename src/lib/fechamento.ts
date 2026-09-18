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

export const PAPEIS_RATEIO = ["levantamento", "fechamento", "captacao"] as const;
export type Papel = (typeof PAPEIS_RATEIO)[number];

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
    listaCache = JSON.parse(fs.readFileSync(p, "utf-8")).corretores;
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
