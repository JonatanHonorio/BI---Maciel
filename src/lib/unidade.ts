import fs from "fs";
import path from "path";
import departamentosJson from "./departamentos.json";
import type { SQL } from "./db";

const departamentos = (departamentosJson as { departamentos: Record<string, string> })
  .departamentos;

export type Tipo = "venda" | "locacao";

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

interface CorrecoesManuais {
  unidade_por_corretor: Record<string, { de: string; para: string }>;
}

let correcoesCache: CorrecoesManuais | null = null;

/** scripts/correcoes_manuais.json — mesma correção usada pelos relatórios da Lais. */
function correcoesManuais(): CorrecoesManuais {
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
  if (unidade === null && tipo === null) return null;

  const correcoes = correcoesManuais().unidade_por_corretor;
  const rows = (await sql`
    SELECT id, departamento_id FROM corretores WHERE ativo = 1
  `) as { id: number; departamento_id: number | null }[];

  const ids: number[] = [];
  for (const r of rows) {
    const nome = r.departamento_id !== null ? departamentos[String(r.departamento_id)] : undefined;
    let sep = separarDepartamento(nome);
    if (!sep) continue;

    const correcao = correcoes[String(r.id)];
    if (correcao && sep.unidade === correcao.de) {
      sep = { ...sep, unidade: correcao.para };
    }

    if (unidade !== null && sep.unidade !== unidade) continue;
    if (tipo !== null && sep.tipo !== tipo) continue;
    ids.push(r.id);
  }
  return ids;
}
