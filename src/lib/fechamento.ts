import type { SQL } from "./db";
import { separarDepartamento, correcoesManuais, type Tipo } from "./unidade";
import departamentosJson from "./departamentos.json";

const departamentos = (departamentosJson as { departamentos: Record<string, string> })
  .departamentos;

// "Secretaria Comercial" (id 272) participa de rateios reais de fechamento
// (Levantamento/Fechamento), mas seu departamento ("Secretaria Comercial",
// id 62) não casa com o padrão "Locação X"/"Vendas X" — por isso ela some
// dos selects normais de corretoresDaUnidade(). Aqui ela entra sempre,
// independente da unidade+tipo escolhidos — confirmado com o Jonatan em
// 17/09/2026.
const CORRETOR_SECRETARIA_COMERCIAL = 272;

export const UNIDADES_FECHAMENTO = [
  "Satélite", "Vista Verde", "Urbanova", "Aquarius", "Esplanada", "Dutra",
  "Diretoria", "Lançamento",
] as const;

export const ORIGENS_FECHAMENTO = [
  "Cliente de Carteira", "Plantão de Vendas", "Canal Pro", "Indicação", "Site",
  "Placa", "OLX", "ZAP", "VivaReal", "ImovelWeb", "Fachada da Imobiliária",
  "V4", "Facebook", "Instagram", "Panfletos", "Status/Story",
] as const;

export const PAGAMENTOS_FECHAMENTO = [
  "Financiamento", "A Vista", "Fgts", "Consórcio", "Parcelado",
] as const;

export const PAPEIS_RATEIO = ["levantamento", "fechamento"] as const;
export type Papel = (typeof PAPEIS_RATEIO)[number];

/** Primeiro dia do mês corrente, formato YYYY-MM-DD (pra coluna DATE). */
export function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Corretores elegíveis pro select de rateio de um fechamento — como
 * corretoresDaUnidade(), mas sempre inclui "Secretaria Comercial" (ver
 * CORRETOR_SECRETARIA_COMERCIAL acima) e não é afetada por
 * corretores_excluidos (aquilo é pra rankings de produtividade, não pra quem
 * pode receber rateio de comissão — são perguntas diferentes).
 */
export async function corretoresParaRateio(
  sql: SQL,
  unidade: string,
  tipo: Tipo
): Promise<{ id: number; nome: string }[]> {
  const rows = (await sql`
    SELECT id, departamento_id,
      COALESCE(NULLIF(TRIM(nome_comercial), ''), NULLIF(TRIM(nome), '')) AS nome
    FROM corretores WHERE ativo = 1
  `) as { id: number; departamento_id: number | null; nome: string | null }[];

  const correcoes = correcoesManuais().unidade_por_corretor;
  const out: { id: number; nome: string }[] = [];
  for (const r of rows) {
    if (!r.nome) continue;
    if (r.id === CORRETOR_SECRETARIA_COMERCIAL) {
      out.push({ id: r.id, nome: r.nome });
      continue;
    }
    const nomeDep = r.departamento_id !== null ? departamentos[String(r.departamento_id)] : undefined;
    let sep = separarDepartamento(nomeDep);
    if (!sep) continue;
    const correcao = correcoes[String(r.id)];
    if (correcao && sep.unidade === correcao.de) sep = { ...sep, unidade: correcao.para };
    if (sep.unidade !== unidade || sep.tipo !== tipo) continue;
    out.push({ id: r.id, nome: r.nome });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome));
}
