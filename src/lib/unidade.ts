import fs from "fs";
import path from "path";
import departamentosJson from "./departamentos.json";
import type { SQL } from "./db";

const departamentos = (departamentosJson as { departamentos: Record<string, string> })
  .departamentos;

export type Tipo = "venda" | "locacao";

// Logins que a diretoria pediu para NÃO contar como captação de unidade —
// mesma lista de scripts/unidade_captacao.py (DIRETORIA_IDS), fixada por id
// de propósito (casar por nome pegaria homônimos).
export const IDS_DIRETORIA = [775, 279, 182, 272];

export interface Separado {
  unidade: string;
  tipo: Tipo;
  gerente: boolean;
}

/** "Locação Vista Verde" -> { unidade: "Vista Verde", tipo: "locacao", gerente: false } */
export function separarDepartamento(nome: string | undefined | null): Separado | null {
  if (!nome) return null;
  const m = nome.match(/^(Gerente\s+)?(Loca[cç][aã]o|Vendas?)\s+(.+)$/i);
  if (!m) return null;
  const tipo: Tipo = /loca/i.test(m[2]) ? "locacao" : "venda";
  return { unidade: m[3].trim(), tipo, gerente: !!m[1] };
}

/** "Locação Vista Verde" -> "Vista Verde"; o que não casa volta como está (ex: "Financeiro"). */
export function unidadeDoDepartamento(depId: number | string | null | undefined): string {
  if (depId === null || depId === undefined) return "—";
  const nome = departamentos[String(depId)];
  if (!nome) return "—";
  const sep = separarDepartamento(nome);
  return sep ? sep.unidade : nome;
}

/**
 * Unidade de exibição por corretor, aplicando a mesma correção manual de
 * cadastro errado (scripts/correcoes_manuais.json) que corretoresDaUnidade()
 * usa pra escopar dados — sem isso o texto na tela (ex: "Urbanova") pode
 * divergir do filtro real aplicado (ex: já escopado como "Satélite").
 */
export function unidadeDoCorretor(
  corretorId: number | null | undefined,
  depId: number | string | null | undefined
): string {
  const base = unidadeDoDepartamento(depId);
  if (corretorId === null || corretorId === undefined) return base;
  const correcao = correcoesManuais().unidade_por_corretor[String(corretorId)];
  if (correcao && base === correcao.de) return correcao.para;
  return base;
}

export interface CorrecoesManuais {
  unidade_por_corretor: Record<
    string,
    { de: string; para: string; de_tipo?: Tipo; para_tipo?: Tipo }
  >;
  corretores_excluidos?: Record<string, { corretor: string }>;
}

let correcoesCache: CorrecoesManuais | null = null;

/** scripts/correcoes_manuais.json — mesma correção usada pelos relatórios da Lais. */
export function correcoesManuais(): CorrecoesManuais {
  if (correcoesCache) return correcoesCache;
  try {
    const p = path.join(process.cwd(), "scripts", "correcoes_manuais.json");
    correcoesCache = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    correcoesCache = { unidade_por_corretor: {} };
  }
  return correcoesCache!;
}

/**
 * IDs dos corretores ativos que pertencem à `unidade` + `tipo` pedidos.
 * `unidade`/`tipo` nulos = sem restrição nessa dimensão; os dois nulos ao
 * mesmo tempo devolvem `null`, que os callers tratam como "sem filtro"
 * (admin). Aplica a correção manual de unidade errada no cadastro do Kurole
 * (scripts/correcoes_manuais.json), igual aos relatórios da Lais.
 */
export async function corretoresDaUnidade(
  sql: SQL,
  unidade: string | null,
  tipo: Tipo | null
): Promise<number[] | null> {
  const excluidos = correcoesManuais().corretores_excluidos ?? {};
  const temExcluidos = Object.keys(excluidos).length > 0;

  // Sem filtro de unidade/tipo (admin) e sem ninguém pra excluir: atalho barato,
  // sem nem consultar o banco — mantém o caminho comum do admin rápido.
  if (unidade === null && tipo === null && !temExcluidos) return null;

  const correcoes = correcoesManuais().unidade_por_corretor;
  const rows = (await sql`
    SELECT id, departamento_id FROM corretores WHERE ativo = 1
  `) as { id: number; departamento_id: number | null }[];

  const ids: number[] = [];
  for (const r of rows) {
    if (excluidos[String(r.id)]) continue;

    // Sem restrição de unidade/tipo (admin): entra todo mundo ativo, exceto excluídos.
    if (unidade === null && tipo === null) {
      ids.push(r.id);
      continue;
    }

    const nome = r.departamento_id !== null ? departamentos[String(r.departamento_id)] : undefined;
    let sep = separarDepartamento(nome);
    if (!sep) continue;

    const correcao = correcoes[String(r.id)];
    if (correcao) {
      if (sep.unidade === correcao.de) sep = { ...sep, unidade: correcao.para };
      if (correcao.para_tipo && sep.tipo === correcao.de_tipo) {
        sep = { ...sep, tipo: correcao.para_tipo };
      }
    }

    if (unidade !== null && sep.unidade !== unidade) continue;
    if (tipo !== null && sep.tipo !== tipo) continue;
    ids.push(r.id);
  }
  return ids;
}

export interface CorretorLotado {
  id: number;
  nome: string;
  unidade: string;
  tipo: Tipo | null;
}

/**
 * Todos os corretores ativos com a lotação já corrigida — unidade E vertical.
 *
 * É o que o card de contrato usa: a Ana escolhe quem vendeu e a unidade sai
 * sozinha do cadastro, porque é a unidade que decide qual gerente enxerga o
 * contrato. Digitada à mão, uma unidade errada esconderia o card do gerente
 * certo sem nenhum erro na tela.
 *
 * Diferente de `corretoresParaRateio`, aqui vem a base ativa inteira: qualquer
 * corretor pode fechar um negócio, inclusive de outra vertical.
 */
export async function corretoresComLotacao(sql: SQL): Promise<CorretorLotado[]> {
  const excluidos = correcoesManuais().corretores_excluidos ?? {};
  const correcoes = correcoesManuais().unidade_por_corretor;

  const rows = (await sql`
    SELECT id, departamento_id,
      COALESCE(NULLIF(TRIM(nome_comercial), ''), NULLIF(TRIM(nome), '')) AS nome
    FROM corretores WHERE ativo = 1
  `) as { id: number; departamento_id: number | null; nome: string | null }[];

  const saida: CorretorLotado[] = [];
  for (const r of rows) {
    if (excluidos[String(r.id)] || !r.nome) continue;

    const nomeDep = r.departamento_id !== null ? departamentos[String(r.departamento_id)] : undefined;
    let sep = separarDepartamento(nomeDep);
    const correcao = correcoes[String(r.id)];
    if (sep && correcao) {
      if (sep.unidade === correcao.de) sep = { ...sep, unidade: correcao.para };
      if (correcao.para_tipo && sep.tipo === correcao.de_tipo) sep = { ...sep, tipo: correcao.para_tipo };
    }

    saida.push({
      id: r.id,
      nome: r.nome,
      // Quem não está num departamento "Vendas X"/"Locação X" (Diretoria,
      // Lançamento, Administrativo) entra com o nome do próprio setor e sem
      // vertical — a Ana escolhe a unidade na mão nesses casos.
      unidade: sep ? sep.unidade : unidadeDoDepartamento(r.departamento_id),
      tipo: sep ? sep.tipo : null,
    });
  }
  return saida.sort((a, b) => a.nome.localeCompare(b.nome));
}
