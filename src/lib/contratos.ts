import type { Session } from "./auth";
import type { Tipo } from "./unidade";

/**
 * Regras do Kanban do setor de contratos (25/09/2026).
 *
 * Mesma disciplina de @/lib/permissoes: SÓ `import type` aqui. Este arquivo é
 * lido pelo proxy (edge) e por componente client — importar valor de
 * @/lib/unidade (que usa fs/path) quebraria o build.
 */

export const FASES = [
  { id: 1, nome: "Recebimento dos docs", curto: "Recebimento" },
  { id: 2, nome: "Análise dos docs", curto: "Análise" },
  { id: 3, nome: "Pendência dos docs", curto: "Pendência" },
  { id: 4, nome: "Contrato em execução", curto: "Execução" },
  { id: 5, nome: "Conferência gerentes e diretoria", curto: "Conferência" },
  { id: 6, nome: "Enviado para assinatura", curto: "Assinatura" },
  { id: 7, nome: "Assinado e finalizado", curto: "Finalizado" },
] as const;

export const FASE_CONFERENCIA = 5;
export const FASE_PENDENCIA = 3;
export const FASE_FINAL = 7;

export function nomeFase(id: number): string {
  return FASES.find((f) => f.id === id)?.nome ?? `fase ${id}`;
}

export function faseValida(id: unknown): id is number {
  return typeof id === "number" && FASES.some((f) => f.id === id);
}

/**
 * Quem opera o quadro: a Ana (role `contratos`) e quem tem acesso total.
 * Criar card, editar dados e mover entre quaisquer fases.
 */
export function podeEditarContrato(s: Session): boolean {
  return s.role === "admin" || s.role === "contratos";
}

/**
 * Unidades que a pessoa enxerga. `null` = todas.
 *
 * A gerente administrativa cai no caso do meio (`s.unidades`), que é o que dá
 * à Rachel as três unidades dela — o mesmo dado que o fechamento já usa.
 *
 * ATENÇÃO — é de propósito que isto NÃO se comporta como `unidadesFechamento`.
 * Lá, unidade nula vira `[]` (nenhuma), porque fechamento é escrita e a Daniela
 * não lança fechamento de unidade alguma. Aqui o Jonatan pediu o oposto
 * explícito: ela acompanha TODOS os contratos de venda da empresa. O que a
 * prende continua sendo a vertical, aplicada logo abaixo.
 */
export function unidadesContrato(s: Session): string[] | null {
  if (s.role === "admin" || s.role === "contratos") return null;
  if (s.unidades?.length) return s.unidades;
  return s.unidade ? [s.unidade] : null;
}

/**
 * Verticais que a pessoa enxerga. `null` = as duas.
 *
 * A gerente administrativa tem `tipo` nulo no cadastro justamente porque cuida
 * das duas verticais da unidade — cai no `null` sem precisar de caso próprio.
 */
export function tiposContrato(s: Session): Tipo[] | null {
  if (s.role === "admin" || s.role === "contratos") return null;
  return s.tipo ? [s.tipo] : null;
}

export function podeVerContrato(s: Session, c: { unidade?: string | null; tipo?: string | null }): boolean {
  const unidades = unidadesContrato(s);
  const tipos = tiposContrato(s);
  const okUnidade = unidades === null || (!!c.unidade && unidades.includes(c.unidade));
  const okTipo = tipos === null || (!!c.tipo && tipos.includes(c.tipo as Tipo));
  return okUnidade && okTipo;
}

/**
 * Conta bancária do vendedor. Decisão do Jonatan em 25/09/2026: o gerente
 * confere contrato, não faz pagamento — não precisa do dado, e espalhá-lo por
 * 13 contas de gerente é risco sem contrapartida. Quem vê: a Ana e quem tem
 * acesso total (Jonatan, Tatiane, Pietra, Suzana).
 *
 * A Daniela NÃO entra aqui: ela é `gerente`, e vê o card sem o bloco bancário.
 */
export function podeVerBanco(s: Session): boolean {
  return s.role === "admin" || s.role === "contratos";
}

/**
 * Movimento permitido. A Ana e o admin movem para onde quiserem; o gerente só
 * age na fase em que o quadro depende dele — conferir (5 → 6) ou devolver
 * (5 → 3) com o motivo. Fora disso o card é só leitura para ele.
 *
 * Devolve a string do erro, ou null quando pode.
 */
export function motivoBloqueioMover(s: Session, de: number, para: number): string | null {
  if (podeEditarContrato(s)) return null;
  // A gerente administrativa acompanha e comenta, mas não confere: a fase 5 é
  // "conferência pelos gerentes e diretoria", e ela não é nenhum dos dois.
  if (s.role === "gerente_adm") return "o acompanhamento administrativo não move o card";
  if (de !== FASE_CONFERENCIA) {
    return "só o setor de contratos move o card fora da conferência";
  }
  if (para !== FASE_CONFERENCIA + 1 && para !== FASE_PENDENCIA) {
    return "na conferência dá para aprovar ou devolver para pendência";
  }
  return null;
}

/** Fases cujo card recém-chegado dispara e-mail para o gerente da unidade. */
export const FASES_QUE_AVISAM = [FASE_PENDENCIA, FASE_CONFERENCIA, FASE_FINAL];
