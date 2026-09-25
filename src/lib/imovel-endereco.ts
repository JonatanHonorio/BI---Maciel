export interface ImovelEndereco {
  endereco: string | null; numero: string | null; complemento: string | null;
  compl_blocos: string | null; unidade_imovel: string | null;
  quadra: string | null; lote: string | null; bairro: string | null;
}

/** Texto limpo, ou "" — o Kurole grava muito campo como "0" e string vazia. */
export const parte = (v: string | null | undefined) => {
  const t = String(v ?? "").trim();
  return t === "" || t === "0" ? "" : t;
};

/**
 * Monta o endereço com tudo que o cadastro tem: logradouro, número,
 * complemento, bloco/torre, unidade, quadra e lote.
 *
 * Antes saía só "logradouro, bairro" e não dava pra saber de qual apartamento
 * era o negócio — a adm redigitava por cima do que o sistema preencheu.
 *
 * Duas limpezas que evitam endereço com lixo: campo gravado como "0" vale como
 * vazio, e a unidade some quando repete o número (imóvel de rua costuma ter os
 * dois iguais, e sairia "Rua X, 451, Unid. 451").
 */
export function montarEndereco(i: ImovelEndereco): string {
  const numero = parte(i.numero);
  const unidade = parte(i.unidade_imovel);
  const quadra = parte(i.quadra);
  const lote = parte(i.lote);

  const pedacos = [
    [parte(i.endereco), numero].filter(Boolean).join(", "),
    parte(i.complemento),
    parte(i.compl_blocos),
    unidade && unidade !== numero ? `Unid. ${unidade}` : "",
    quadra ? `Qd ${quadra}` : "",
    lote && lote !== numero ? `Lt ${lote}` : "",
    parte(i.bairro),
  ];
  return pedacos.filter(Boolean).join(" - ");
}
