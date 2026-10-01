/**
 * Como a comissão de um negócio é repartida (regras dadas pelo Jonatan em
 * 21/09/2026, Lançamento revisto em 22/09/2026).
 *
 * Tudo incide sobre a COMISSÃO do fechamento — não sobre o valor do imóvel.
 * Em venda é o campo Comissão; em locação é o valor da prestação de serviço
 * (o primeiro aluguel, que fica com a imobiliária).
 *
 * Este arquivo não importa nada de propósito: o formulário é client component
 * e `@/lib/fechamento` puxa `fs` via `unidade.ts`, então as regras não podem
 * morar lá.
 */

// Lançamento entrou aqui em 22/09/2026. Era um botão de 5% fixo, e não servia:
// o Maciel traz um diretor de lançamento diferente a cada produto, e o
// percentual muda junto. Virou um bloco de pessoas como os outros, só que com
// o percentual digitado na mão.
export const PAPEIS_PESSOA = [
  "levantamento", "fechamento", "gerencia", "lancamento",
] as const;

/**
 * Destinação sem pessoa: o destinatário é o próprio rótulo.
 *
 * `brizola` existiu aqui como botão de 5% e saiu em 22/09/2026 junto com o de
 * Lançamento — quem participa de um negócio nessa condição agora entra pelo
 * nome, no bloco Lançamento. Saiu inteiro, e não como papel legado, porque o
 * único negócio gravado com ele era o teste da Satélite, apagado no mesmo dia.
 */
export const PAPEIS_RUBRICA = [
  "diretoria_1", "diretoria_2", "diretoria_3",
] as const;
export const PAPEIS_RATEIO = [...PAPEIS_PESSOA, ...PAPEIS_RUBRICA] as const;

export type Papel = (typeof PAPEIS_RATEIO)[number];
export type PapelPessoa = (typeof PAPEIS_PESSOA)[number];
export type Tipo = "venda" | "locacao";

export function ehRubrica(papel: string): boolean {
  return (PAPEIS_RUBRICA as readonly string[]).includes(papel);
}

/**
 * 0.005 -> "0.5%", 0.3 -> "30%".
 *
 * Arredondar para inteiro NÃO serve: a Diretoria 3 recebe 0,5% e aparecia
 * como "1%" na tela de comissões — o dobro do que é. Os centésimos só
 * aparecem quando existem, pra 30% não virar "30.00%".
 */
export function pctTexto(fracao: number): string {
  return `${(fracao * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  levantamento: "Levantamento",
  fechamento: "Fechamento",
  gerencia: "Gerência",
  lancamento: "Lançamento",
  diretoria_1: "Diretoria 1",
  diretoria_2: "Diretoria 2",
  diretoria_3: "Diretoria 3",
};

interface Rubrica {
  papel: Papel;
  rotulo: string;
  percentual: number;
}

interface Regra {
  /** 10% da comissão para a captação — DIVIDIDO entre os captadores. */
  levantamento: number;
  fechamento: number;
  gerencia: number;
  /**
   * `null` = o bloco existe, mas sem percentual de tabela: é digitado caso a
   * caso, e o formulário não redistribui sozinho. `false` = não existe nessa
   * vertical.
   *
   * Lançamento não tem número fixo: depende do produto e de quem é o diretor
   * daquele lançamento (no Parque Floresta, dez/2025, foram 10%).
   */
  lancamento: number | null | false;
  rubricas: Rubrica[];
}

export const REGRAS: Record<Tipo, Regra> = {
  venda: {
    levantamento: 0.10,
    fechamento: 0.30,
    gerencia: 0.10,
    lancamento: null,
    rubricas: [
      { papel: "diretoria_1", rotulo: "Diretoria 1", percentual: 0.03 },
      { papel: "diretoria_2", rotulo: "Diretoria 2", percentual: 0.01 },
      { papel: "diretoria_3", rotulo: "Diretoria 3", percentual: 0.005 },
    ],
  },
  locacao: {
    levantamento: 0.10,
    fechamento: 0.30,
    // 20%, e não os 10% da venda (01/10/2026). O BI vinha com 10% por
    // informação errada; a composição real da locação é
    // 20 + 30 + 10 + 3 = 63%, e cinco negócios já tinham sido lançados
    // assim pelas adms antes de a regra ser corrigida aqui.
    gerencia: 0.20,
    // Lançamento é coisa de venda: quem lança um empreendimento não entra no
    // primeiro aluguel. Se um dia precisar, é só trocar por `null` e o bloco
    // aparece na locação também.
    lancamento: false,
    // Em locação a diretoria é uma linha só. Fica em `diretoria_1` pra não
    // inventar um papel que só existiria numa vertical.
    rubricas: [
      { papel: "diretoria_1", rotulo: "Diretoria", percentual: 0.03 },
    ],
  },
};

/** Rótulo da rubrica no tipo certo — "Diretoria" em locação, "Diretoria 1" em venda. */
export function rotuloRubrica(tipo: Tipo, papel: Papel): string {
  return REGRAS[tipo].rubricas.find((r) => r.papel === papel)?.rotulo ?? ROTULO_PAPEL[papel];
}

/**
 * Percentual de cada linha de um bloco de PESSOAS, ou `null` quando o bloco
 * é de percentual manual.
 *
 * O percentual é da FUNÇÃO, não da pessoa: a Maciel paga 10% pela captação,
 * 30% pelo fechamento e 10% pela gerência, e quem dividir divide entre os
 * envolvidos. Dois captadores ficam com 5% cada; dois fechadores, 15% cada.
 *
 * Com uma linha só o resultado é o percentual cheio, que é o caso comum.
 */
export function percentualSugerido(
  tipo: Tipo, papel: PapelPessoa, quantasLinhas: number
): number | null {
  const total = REGRAS[tipo][papel];
  if (typeof total !== "number") return null;
  return quantasLinhas > 0 ? total / quantasLinhas : total;
}

/**
 * Captadores com percentual próprio (01/10/2026): Mauro Souza, José Rafael
 * Girotto e Dimas Barbosa captam por **20%** em vez dos 10% de tabela, em
 * venda e em locação.
 *
 * Os 10 pontos a mais saem do FECHADOR, não da imobiliária: o bloco
 * Fechamento cai de 30% para 20% e o negócio continua somando 54,5% em venda
 * e 53% em locação. Confirmado pelo Jonatan e pelo único negócio que já tinha
 * sido lançado com a regra (o #879 da Aquarius).
 *
 * ⚠️ A regra não diz o que fazer quando a captação é DIVIDIDA com outra
 * pessoa — "20% para cada" estouraria a soma. Nesses casos o formulário
 * reparte os 20% entre os captadores, que é o único resultado que fecha a
 * conta, e os negócios já lançados assim ficaram sem correção de propósito.
 */
export const CAPTADORES_20 = [209, 207, 174] as const;

export function captacaoDiferenciada(ids: (number | string | null | undefined)[]): boolean {
  return ids.some((id) => (CAPTADORES_20 as readonly number[]).includes(Number(id)));
}

/** Levantamento e Fechamento, já considerando o captador de 20%. */
export function percentuaisCaptacao(tipo: Tipo, comCaptador20: boolean) {
  const r = REGRAS[tipo];
  const extra = comCaptador20 ? 0.10 : 0;
  return { levantamento: r.levantamento + extra, fechamento: r.fechamento - extra };
}

/**
 * O Zulietti (01/10/2026). Ele participa dos lançamentos e recebe rateio, mas
 * NÃO tem cadastro no Kurole — o cadastro dele existe só aqui, com um id fora
 * da faixa do Kurole (ver `scripts/add-corretor-zulietti.js`).
 *
 * A regra que o acompanha: quando ele entra no bloco Lançamento, os 10% da
 * GERÊNCIA se partem ao meio — 5% para ele e 5% para o gerente da venda. Não
 * é um percentual novo saindo da imobiliária; é o mesmo bolo dividido.
 *
 * Por isso a regra mora aqui e não vira um `if` escondido no formulário: é
 * regra de comissão como as outras, e quem mexer nos percentuais um dia
 * precisa esbarrar nela.
 */
export const ID_ZULIETTI = 900001;

/** Quanto a Gerência paga, considerando a partição com o Zulietti. */
export function percentualGerencia(tipo: Tipo, comZulietti: boolean): number {
  const cheio = REGRAS[tipo].gerencia;
  return comZulietti ? cheio / 2 : cheio;
}

/** O bloco de Lançamento só aparece onde a regra o prevê (hoje, só venda). */
export function temBlocoLancamento(tipo: Tipo): boolean {
  return REGRAS[tipo].lancamento !== false;
}

/**
 * Quanto ainda falta pagar, com o resto de arredondamento zerado
 * (30/09/2026).
 *
 * O devido de cada linha é percentual × comissão e quase nunca cai num
 * centavo redondo — a Diretoria 3 de um negócio de R$ 7.192,80 deve
 * R$ 35,964. A adm paga R$ 35,96, e a diferença de quatro décimos de centavo
 * ficava eternamente "a pagar". Não existe fração de centavo em
 * transferência: abaixo de um centavo, está quitado.
 */
export function pendenteAPagar(devido: number, pago: number): number {
  const falta = devido - pago;
  return falta < 0.01 ? 0 : falta;
}

export interface LinhaRateioCalc {
  papel: string;
  percentual: number | null;
}

/**
 * Soma o que sai da comissão e o que sobra para a imobiliária.
 *
 * Serve pra tela mostrar o resultado enquanto a pessoa digita: com as regras
 * cheias, venda distribui 54,5% e locação 63% — mais o que o Lançamento
 * levar, que varia. Passar de 100% é erro de digitação, e é melhor ver antes
 * de salvar.
 */
export function resumoRateio(pool: number, linhas: LinhaRateioCalc[]) {
  const distribuido = linhas.reduce((s, l) => s + (l.percentual ?? 0), 0);
  return {
    percentualDistribuido: distribuido,
    valorDistribuido: pool * distribuido,
    percentualImobiliaria: 1 - distribuido,
    valorImobiliaria: pool * (1 - distribuido),
    estourou: distribuido > 1.0000001,
  };
}
