/**
 * Como a comissão de um negócio é repartida (regras dadas pelo Jonatan em
 * 21/09/2026).
 *
 * Tudo incide sobre a COMISSÃO do fechamento — não sobre o valor do imóvel.
 * Em venda é o campo Comissão; em locação é o valor da prestação de serviço
 * (o primeiro aluguel, que fica com a imobiliária).
 *
 * Este arquivo não importa nada de propósito: o formulário é client component
 * e `@/lib/fechamento` puxa `fs` via `unidade.ts`, então as regras não podem
 * morar lá.
 */

export const PAPEIS_PESSOA = ["levantamento", "fechamento", "gerencia"] as const;
export const PAPEIS_RUBRICA = [
  "diretoria_1", "diretoria_2", "diretoria_3", "lancamento", "brizola",
] as const;
export const PAPEIS_RATEIO = [...PAPEIS_PESSOA, ...PAPEIS_RUBRICA] as const;

export type Papel = (typeof PAPEIS_RATEIO)[number];
export type PapelPessoa = (typeof PAPEIS_PESSOA)[number];
export type Tipo = "venda" | "locacao";

export function ehRubrica(papel: string): boolean {
  return (PAPEIS_RUBRICA as readonly string[]).includes(papel);
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  levantamento: "Levantamento",
  fechamento: "Fechamento",
  gerencia: "Gerência",
  diretoria_1: "Diretoria 1",
  diretoria_2: "Diretoria 2",
  diretoria_3: "Diretoria 3",
  lancamento: "Lançamento",
  brizola: "Brizola",
};

interface Rubrica {
  papel: Papel;
  rotulo: string;
  percentual: number;
  /** Rubrica obrigatória entra sozinha; opcional depende de o usuário ligar. */
  obrigatoria: boolean;
}

interface Regra {
  /** 10% da comissão para a captação — DIVIDIDO entre os captadores. */
  levantamento: number;
  fechamento: number;
  gerencia: number;
  rubricas: Rubrica[];
}

export const REGRAS: Record<Tipo, Regra> = {
  venda: {
    levantamento: 0.10,
    fechamento: 0.30,
    gerencia: 0.10,
    rubricas: [
      { papel: "diretoria_1", rotulo: "Diretoria 1", percentual: 0.03, obrigatoria: true },
      { papel: "diretoria_2", rotulo: "Diretoria 2", percentual: 0.01, obrigatoria: true },
      { papel: "diretoria_3", rotulo: "Diretoria 3", percentual: 0.005, obrigatoria: true },
      // Nem toda venda tem influência do setor de lançamentos ou do Brizola;
      // quando tem, a adm liga na tela.
      { papel: "lancamento", rotulo: "Lançamento", percentual: 0.05, obrigatoria: false },
      { papel: "brizola", rotulo: "Brizola", percentual: 0.05, obrigatoria: false },
    ],
  },
  locacao: {
    levantamento: 0.10,
    fechamento: 0.30,
    gerencia: 0.10,
    // Em locação a diretoria é uma linha só. Fica em `diretoria_1` pra não
    // inventar um papel que só existiria numa vertical.
    rubricas: [
      { papel: "diretoria_1", rotulo: "Diretoria", percentual: 0.03, obrigatoria: true },
    ],
  },
};

/** Rótulo da rubrica no tipo certo — "Diretoria" em locação, "Diretoria 1" em venda. */
export function rotuloRubrica(tipo: Tipo, papel: Papel): string {
  return REGRAS[tipo].rubricas.find((r) => r.papel === papel)?.rotulo ?? ROTULO_PAPEL[papel];
}

/**
 * Percentual sugerido para cada linha de um bloco de PESSOAS.
 *
 * O levantamento é o único que divide: a Maciel paga 10% pela captação
 * inteira, então dois captadores ficam com 5% cada. Fechamento e gerência são
 * percentuais por pessoa — se houver dois fechadores, cada um recebe 30%, e é
 * decisão de quem preenche reduzir na mão.
 */
export function percentualSugerido(tipo: Tipo, papel: PapelPessoa, quantasLinhas: number): number {
  const regra = REGRAS[tipo];
  if (papel === "levantamento") return quantasLinhas > 0 ? regra.levantamento / quantasLinhas : regra.levantamento;
  return regra[papel];
}

export interface LinhaRateioCalc {
  papel: string;
  percentual: number | null;
}

/**
 * Soma o que sai da comissão e o que sobra para a imobiliária.
 *
 * Serve pra tela mostrar o resultado enquanto a pessoa digita: com as regras
 * cheias, venda distribui 54,5% (64,5% com lançamento e Brizola) e locação
 * 53%. Passar de 100% é erro de digitação, e é melhor ver antes de salvar.
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
