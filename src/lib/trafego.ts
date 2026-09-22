/**
 * Regras de leitura do tráfego pago, tiradas do handoff
 * `Documents/Maciel/API/HANDOFF_TRAFEGO_PAGO_15SET2026.md` (seção 14, escrita
 * para esta sessão). Quase todas nasceram de erro que deu número errado **sem
 * dar erro** — vale ler o porquê antes de mexer.
 *
 * Este arquivo não importa nada de propósito: serve a rota (server) e à tela
 * (client component).
 */

export type Moeda = "leads" | "conversas";

/**
 * 🔴 Leads e conversas NÃO se somam: são moedas diferentes.
 *
 * Campanha de cadastros conta **lead**; campanha de mensagens conta
 * **conversa**. E uma campanha de cadastros TAMBÉM gera conversas — somar as
 * duas na Vila Amélia inflou o resultado em ~35% e fez R$7,33/lead parecer
 * R$5,42, com uma campanha em queda passando por saudável durante semanas.
 *
 * Quem decide é o OBJETIVO da campanha, nunca o volume observado.
 */
export function moedaDoObjetivo(objetivo: string | null): Moeda {
  return (objetivo || "").toUpperCase().includes("ENGAGEMENT") ? "conversas" : "leads";
}

export const ROTULO_MOEDA: Record<Moeda, { plural: string; um: string; canal: string }> = {
  leads: { plural: "leads", um: "lead", canal: "Formulário" },
  conversas: { plural: "conversas", um: "conversa", canal: "WhatsApp" },
};

/**
 * Nome curto a partir do nome real da campanha.
 *
 * Derivado, e não um mapa de IDs escrito à mão, porque campanha nova entraria
 * muda: o Altus já caiu em "outros" e quase foi publicado assim. Aqui, uma
 * campanha desconhecida aparece com o nome que tiver — feio, mas visível.
 */
export function rotuloCampanha(nome: string | null): string {
  let s = (nome || "").trim();
  // [V4] é a agência; [CADASTROS]/[CONVERSAS] viram o canal, mostrado à parte;
  // [I.A] e [R$ 50,00] são anotações de operação.
  s = s.replace(/\[\s*(V4|CADASTROS|CONVERSAS|I\.?A|R\$[^\]]*)\s*\]/gi, " ");
  // Sobrou um [NOME DO PRODUTO]? É ele que vale.
  const entre = s.match(/\[([^\]]+)\]/);
  if (entre) s = entre[1];
  else s = s.split(/\s+[-—]\s+/)[0]; // senão, o que vem antes do traço
  s = s.replace(/\s+/g, " ").trim().replace(/^[-—\s]+|[-—\s]+$/g, "");
  // MAIÚSCULAS viram Capitalizadas; nome já escrito normalmente fica como está.
  // Preposição no meio fica minúscula, senão sai "Imoveis De Terceiros".
  if (s === s.toUpperCase()) {
    const minusculas = new Set(["de", "do", "da", "dos", "das", "e", "em", "no", "na"]);
    s = s
      .toLowerCase()
      .split(" ")
      .map((w, i) => (i > 0 && minusculas.has(w) ? w : w.replace(/^([a-zà-ú])/, (c) => c.toUpperCase())))
      .join(" ");
  }
  return s || (nome || "sem nome");
}

/**
 * Produto do ANÚNCIO, não da campanha — e a ordem das regras importa.
 *
 * `[IMÓVEIS TERCEIROS]` roda Casa do Cristian E Jardim Limoeiro na mesma
 * campanha, então só o nome do anúncio separa os dois. E `[AREA VILA AMELIA
 * 1.533m2]` contém "VILA AMELIA" sendo outro produto (terreno de R$1,84 mi):
 * precisa ser testado ANTES da regra da Vila Amélia.
 */
export function produtoDoAnuncio(campanha: string | null, anuncio: string | null): string {
  const c = (campanha || "").toUpperCase();
  const a = (anuncio || "").toUpperCase();
  if (c.includes("MARTIM")) return "Martim";
  if (c.includes("ALTUS")) return "Altus América";
  if (c.includes("AREA VILA")) return "Área 1.533 m²";
  if (c.includes("VILA AM")) return c.includes("CONVERSAS") ? "Vila Amélia WhatsApp" : "Vila Amélia Formulário";
  if (c.includes("QUADRIA")) return "Quadria Vista Verde";
  if (a.includes("LIMOEIRO")) return "Jardim Limoeiro";
  return "Casa do Cristian";
}

/**
 * Faixa esperada de custo por resultado, por produto.
 *
 * Custo por resultado sobe com o ticket do imóvel — um limite único para a
 * conta inteira pintaria o Martim de vermelho para sempre e deixaria a Vila
 * Amélia verde enquanto piora.
 */
export interface Faixa { min: number; max: number; ticket: string }

/**
 * A ORDEM decide o resultado.
 *
 * `null` = produto conhecido que não tem faixa comparável. É o caso da Área
 * 1.533 m²: o handoff dá R$150–400, mas medidos em "contato APROVEITÁVEL",
 * que o BI ainda não sabe contar — comparar com custo por conversa pintaria
 * R$21 de verde como se fosse ótimo.
 *
 * ⚠️ E `[AREA VILA AMELIA 1.533m2]` contém "VILA AMELIA" sendo outro produto
 * (terreno de R$1,84 mi). Tem que sair ANTES da regra da Vila Amélia — sem
 * essa linha ele herda a faixa de R$6–9 do PMCMV, que é a armadilha descrita
 * no handoff.
 */
const FAIXAS: [RegExp, Faixa | null][] = [
  [/MARTIM|PARQUE UNA/i, { min: 40, max: 75, ticket: "salas · R$300 mil a 1 mi" }],
  [/ALTUS/i, { min: 12, max: 25, ticket: "R$595 a 782 mil" }],
  [/AREA VILA/i, null],
  [/VILA AM/i, { min: 6, max: 9, ticket: "PMCMV · R$304 mil" }],
  [/TERCEIROS|CRISTIAN|LIMOEIRO/i, { min: 6, max: 10, ticket: "R$450 mil" }],
];

export function faixaDoProduto(nomeCampanha: string | null): Faixa | null {
  const n = nomeCampanha || "";
  for (const [re, faixa] of FAIXAS) if (re.test(n)) return faixa;
  return null;
}

/** Produto que a régua conhece, ainda que sem faixa comparável — separa "não
 *  tem faixa de propósito" de "campanha nova que ninguém mapeou". */
export function produtoConhecido(nomeCampanha: string | null): boolean {
  const n = nomeCampanha || "";
  return FAIXAS.some(([re]) => re.test(n));
}

export type Situacao = "dentro" | "acima" | "abaixo" | "sem_faixa";

/** Acima da faixa é o alerta; abaixo é bom, e some do vermelho. */
export function situacaoDoCusto(custo: number, faixa: Faixa | null): Situacao {
  if (!faixa || !custo) return "sem_faixa";
  if (custo > faixa.max) return "acima";
  if (custo < faixa.min) return "abaixo";
  return "dentro";
}

/**
 * Comparação do custo recente com o do período.
 *
 * Com 2 a 6 resultados por dia o custo diário oscila absurdamente — já rendeu
 * um "piorou 130%" quando a piora real por janela era de 23%. Por isso a
 * comparação é de JANELA (7 dias) contra o período, nunca de dia contra dia, e
 * variação abaixo de 5% é ruído, não tendência.
 */
export function tendencia(custoPeriodo: number, custo7d: number): "melhor" | "pior" | "estavel" {
  if (!custoPeriodo || !custo7d) return "estavel";
  const variacao = (custo7d - custoPeriodo) / custoPeriodo;
  if (variacao < -0.05) return "melhor";
  if (variacao > 0.05) return "pior";
  return "estavel";
}
