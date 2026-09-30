/**
 * Campos que um negócio do fechamento precisa ter para ser lançado
 * (30/09/2026).
 *
 * Nasceu de um caso real: o gerente da Dutra enviou o fechamento de setembro
 * com uma venda sem forma de pagamento, e só se descobriu olhando a tabela.
 * Campo vazio não dá erro em lugar nenhum — ele simplesmente some do relatório
 * e da conferência com a planilha da diretoria.
 *
 * Este arquivo NÃO importa nada de propósito: a mesma função roda no
 * formulário (client component) e nas rotas de escrita, para as duas portas
 * não divergirem. Já aconteceu de uma aceitar o que a outra recusava.
 *
 * O que ficou de FORA da obrigatoriedade, e por quê:
 *  - **nº do Contrato (CT)**: muita venda é lançada antes de o contrato ser
 *    numerado, e 354 dos 832 negócios já lançados não têm número — exigir
 *    travaria o lançamento por uma informação que a adm ainda não tem;
 *  - **Levantamento (captador)**: existe venda sem captador da casa, como a
 *    de composição com outra imobiliária;
 *  - **Gerência**: a Diretoria não tem gerente, e o bloco fica vazio ali;
 *  - **Observação**: é anotação livre.
 */

export type TipoNegocio = "venda" | "locacao";

export interface NegocioObrigatorio {
  data_contrato?: string | null;
  ref?: string | null;
  endereco?: string | null;
  origem?: string | null;
  /** Venda: a comissão. Locação: a prestação de serviço. */
  valor?: number | null;
  comissao?: number | null;
  pagamento?: string | null;
  rateio?: { papel: string }[];
}

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Devolve os rótulos dos campos que faltam, na ordem em que aparecem na tela.
 * Lista vazia = pode salvar.
 */
export function camposFaltando(n: NegocioObrigatorio, tipo: TipoNegocio): string[] {
  const faltam: string[] = [];

  if (vazio(n.data_contrato)) faltam.push("Data Contrato");
  if (vazio(n.ref)) faltam.push("Ref");
  if (vazio(n.endereco)) faltam.push("Endereço");

  // Em venda o que a adm digita é a COMISSÃO (o valor sai dela); em locação é
  // o valor da prestação de serviço. Zero conta como não preenchido: negócio
  // que não gera comissão nenhuma é erro de digitação, não um caso de uso.
  if (tipo === "venda") {
    if (!n.comissao || n.comissao <= 0) faltam.push("Comissão (R$)");
  } else if (!n.valor || n.valor <= 0) {
    faltam.push("Valor da locação");
  }

  if (vazio(n.origem)) faltam.push("Origem");
  // Forma de pagamento só existe em venda — locação não tem financiamento.
  if (tipo === "venda" && vazio(n.pagamento)) faltam.push("Pagamento");

  // Sem vendedor não há a quem pagar os 30% do Fechamento, e o negócio não
  // entra em nenhum ranking.
  if (!(n.rateio ?? []).some((r) => r.papel === "fechamento")) {
    faltam.push("Fechamento (quem vendeu)");
  }

  return faltam;
}

/** Mensagem única para a tela e para o corpo do erro da API. */
export function erroCamposFaltando(faltam: string[]): string {
  return faltam.length === 1
    ? `Falta preencher: ${faltam[0]}.`
    : `Faltam preencher: ${faltam.join(", ")}.`;
}
