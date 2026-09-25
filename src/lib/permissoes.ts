import type { Session, Role } from "./auth";
import type { Tipo } from "./unidade";

/**
 * Quem pode o quê no fechamento. Só `import type` aqui de propósito: este
 * arquivo é importado pelo proxy (edge) e por componentes client, e
 * @/lib/fechamento puxa @/lib/unidade, que usa fs/path — importar valor de lá
 * quebra o build.
 *
 * Regra de ouro: sem unidade, a resposta é [] (nenhuma), NUNCA null (todas).
 * A Daniela é diretora de vendas com unidade nula e hoje não escreve em
 * fechamento nenhum; tratar "unidade nula" como "todas" daria a ela escrita
 * em todo fechamento de venda da empresa.
 */

/** Unidades que a pessoa pode ver/lançar. `null` = todas (só admin). */
export function unidadesFechamento(s: Session): string[] | null {
  if (s.role === "admin") return null;
  if (s.unidades?.length) return s.unidades;
  return s.unidade ? [s.unidade] : [];
}

/** Verticais que a pessoa pode ver/lançar. `null` = as duas. */
export function tiposFechamento(s: Session): Tipo[] | null {
  if (s.role === "admin") return null;
  if (s.tipo) return [s.tipo];
  // Gerente administrativa cuida das duas verticais da unidade dela.
  return s.role === "gerente_adm" ? null : [];
}

/**
 * `p` chega como linha crua do banco (unidade/tipo podem vir nulos se o
 * período não existir) — período sem unidade ou sem tipo não é acessível por
 * ninguém além do admin.
 */
export function podeAcessarPeriodo(s: Session, p: { unidade?: string | null; tipo?: string | null }): boolean {
  const unidades = unidadesFechamento(s);
  const tipos = tiposFechamento(s);
  const okUnidade = unidades === null || (!!p.unidade && unidades.includes(p.unidade));
  const okTipo = tipos === null || (!!p.tipo && tipos.includes(p.tipo as Tipo));
  return okUnidade && okTipo;
}

/** Lançar/apagar pagamento de comissão. O escopo de unidade é checado à parte. */
export function podeLancarComissao(s: Session): boolean {
  return s.role === "admin" || s.role === "gerente_adm";
}

/** Destravar um período já enviado — confirmado com o Jonatan: só admin. */
export function podeReabrir(s: Session): boolean {
  return s.role === "admin";
}

/** Rotas liberadas, quando o perfil só enxerga parte do BI. `null` = tudo. */
function rotasPermitidas(s: Session): string[] | null {
  // A gerente administrativa acompanha também os contratos da própria unidade
  // (26/09/2026) — ela vê o quadro, mas não cria nem edita card: quem opera é
  // a Ana, e isso é decidido em @/lib/contratos, não aqui.
  if (s.role === "gerente_adm") {
    return ["/fechamento", "/api/fechamento", "/contratos", "/api/contratos"];
  }
  if (s.role === "contratos") return ["/contratos", "/api/contratos"];
  return null;
}

export function rotaPermitida(s: Session, pathname: string): boolean {
  const rotas = rotasPermitidas(s);
  // Compara o caminho inteiro pra "/fechamentos" não passar por "/fechamento".
  return rotas === null || rotas.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

/** Pra onde mandar a pessoa depois do login (e quando ela bate numa rota proibida). */
export function rotaInicial(s: Session): string {
  if (s.role === "gerente_adm") return "/fechamento";
  if (s.role === "contratos") return "/contratos";
  return "/resumo";
}

/** Rótulo do rodapé da sidebar. */
export function descricaoAcesso(s: Session): string {
  if (s.role === "admin") return "Acesso total";
  if (s.role === "gerente_adm") return "Administrativo";
  if (s.role === "contratos") return "Contratos";
  if (s.tipo === "venda") return "Vendas";
  if (s.tipo === "locacao") return "Locação";
  return "";
}

export type { Role };
