import { UNIDADES_FECHAMENTO } from "./fechamento";
import { faseValida, GARANTIAS_LOCACAO } from "./contratos";

/**
 * Peças compartilhadas pelas rotas de contrato.
 *
 * Moram aqui e não no route.ts porque o Next só aceita os handlers HTTP como
 * export de um route handler — exportar helper de lá quebra a checagem de
 * tipos do build.
 */

export interface CorpoContrato {
  ref?: string;
  imovel_id?: number | null;
  tipo?: string;
  unidade?: string;
  corretor_id?: number | null;
  corretor_nome?: string;
  vendedor?: unknown;
  comprador?: unknown;
  imovel_endereco?: string | null;
  imovel_dados?: unknown;
  banco?: unknown;
  pagamento?: string | null;
  observacao?: string | null;
  garantia?: string | null;
  garantia_detalhe?: string | null;
  fase?: number;
}

/**
 * Linha pronta pra tela. Sem permissão, a coluna `banco` sai INTEIRA em vez de
 * campo a campo — assim um campo novo dentro do JSON não vaza sozinho no dia em
 * que alguém acrescentar um.
 */
export function limparContrato<T extends Record<string, unknown>>(c: T, verBanco: boolean) {
  if (verBanco) return c;
  const { banco: _banco, ...resto } = c;
  void _banco;
  return { ...resto, banco: null, banco_oculto: true };
}

/**
 * Valida o que vem do formulário. Unidade e tipo escopam o card inteiro —
 * unidade escrita errada esconderia o contrato do gerente certo sem erro
 * nenhum na tela, então tem que casar com a lista oficial.
 */
export function validarBase(b: CorpoContrato): string | null {
  if (!b.ref?.trim()) return "referência é obrigatória";
  if (b.tipo !== "venda" && b.tipo !== "locacao") return "tipo inválido";
  if (!b.unidade || !(UNIDADES_FECHAMENTO as readonly string[]).includes(b.unidade)) {
    return "unidade inválida";
  }
  if (b.fase !== undefined && !faseValida(b.fase)) return "fase inválida";
  // Garantia é lista fechada: texto solto viraria "seguro fiança", "seg.
  // fianca" e "SEGURO-FIANÇA" na mesma coluna, e aí não dá para filtrar.
  if (b.garantia && !(GARANTIAS_LOCACAO as readonly string[]).includes(b.garantia)) {
    return "garantia inválida";
  }
  return null;
}

/** JSON pro jsonb: nunca `undefined`, sempre um valor válido. */
export function json(v: unknown, padrao: "[]" | "{}"): string {
  if (v === undefined || v === null) return padrao;
  return JSON.stringify(v);
}
