import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Consulta o corretor responsável por um lead a partir do telefone.
 *
 * Substitui o mapa fixo de telefone→corretor colado dentro do Apps Script
 * da planilha "Leads Casa do Cristian" (fotografia do dump de 22/08/2026).
 *
 * A fonte do responsável é `lead_responsaveis` (ordem_atendimento_responsaveis
 * do KSI) — NÃO `leads.corretor_id`, que aponta para a caixa da unidade e faz
 * parecer que os leads estão sem corretor. Ver memória kurole_primeiro_corretor.
 *
 * ATENÇÃO ao que esta rota NÃO responde: quem deu o PRIMEIRO atendimento.
 * Medido em 25/08/2026, 99,98% das ordens têm um único registro em
 * lead_responsaveis (só 27 ordens em 122 mil têm mais de um corretor), ou seja,
 * a tabela guarda o responsável atual e não o histórico. O histórico de
 * transferências fica em `lead_atividades` e exige a lógica do
 * `scripts/lais-visitas-excel-v3.js`. Para "primeiro atendimento", usar aquela.
 *
 * Uso:
 *   GET  /api/corretor?telefone=5512999998888
 *   POST /api/corretor  { "telefones": ["5512999998888", "(12) 98888-7777"] }
 *
 * Autenticação: header `Authorization: Bearer <BI_API_TOKEN>` ou o cookie de sessão do BI.
 */

const MAX_TELEFONES = 500;

/**
 * Últimos 9 dígitos — mesma chave do `leads-corretor-v2.js` e do Apps Script,
 * que é como os casos de teste foram validados contra a tela do Kurole.
 * (Fixos antigos de 8 dígitos não casam; é uma limitação herdada, não um bug novo.)
 */
function chaveTelefone(bruto: string): string | null {
  const digitos = String(bruto || "").replace(/\D/g, "");
  if (digitos.length < 9) return null;
  return digitos.slice(-9);
}

/**
 * Aceita ISO ou "yyyy-MM-dd" e devolve a hora de parede em São Paulo, no formato
 * "yyyy-MM-dd HH:mm:ss". Os timestamps do Kurole são naive em horário local — se
 * comparados direto com um ISO em UTC, entram 3h de defasagem, o que troca o
 * vencedor quando a pessoa tem duas ordens abertas no mesmo dia.
 */
function normalizarData(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;

  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(d);
  return p.replace("T", " "); // sv-SE já sai como "yyyy-MM-dd HH:mm:ss"
}

/**
 * Esta rota fica FORA do middleware (para o Apps Script poder chamar sem cookie),
 * então ela mesma precisa autenticar. Nunca liberar por ausência de configuração:
 * sem cookie de sessão e sem BI_API_TOKEN válido, nega.
 */
function autorizado(req: NextRequest): boolean {
  // Uso pelo próprio BI, já logado no navegador.
  if (req.cookies.get("bi_token")?.value) return true;

  const esperado = process.env.BI_API_TOKEN;
  if (!esperado) return false;

  const header = req.headers.get("authorization") || "";
  const enviado = header.replace(/^Bearer\s+/i, "").trim();
  return enviado.length > 0 && enviado === esperado;
}

type Consulta = { telefone: string; data: string | null };

type Resultado = {
  telefone: string;
  cliente: string | null;
  lead_id: number | null;
  unidade_id: number | null;
  data_inicio: string | null;
  corretor: string | null;
  corretor_id: number | null;
};

async function buscar(consultas: Consulta[]): Promise<Record<string, Resultado | null>> {
  const sql = getDb();

  // chave (9 dígitos) → primeira consulta que caiu nela
  const chaves = new Map<string, Consulta>();
  for (const q of consultas) {
    const k = chaveTelefone(q.telefone);
    if (k && !chaves.has(k)) chaves.set(k, q);
  }

  const saida: Record<string, Resultado | null> = {};
  for (const q of consultas) saida[q.telefone] = null;
  if (chaves.size === 0) return saida;

  const listaChaves = [...chaves.keys()];
  const listaDatas = listaChaves.map((k) => chaves.get(k)!.data ?? null);

  /*
   * Para cada chave de telefone:
   *   - agrega TODOS os cadastros de cliente com aquele telefone (celular ou fone) —
   *     a mesma pessoa costuma ter vários cadastros no Kurole;
   *   - escolhe UMA ordem de atendimento: a que abriu mais perto da data informada
   *     (mesma regra do `preencher-corretores-planilha.js`, que foi como o mapa da
   *     planilha de leads foi montado). Sem data, cai na ordem mais recente — a
   *     pessoa pode ter várias ordens ao longo dos anos, e um lead de junho não
   *     pertence ao corretor de uma ordem aberta em agosto;
   *   - dessa ordem, tira o responsável mais recente em lead_responsaveis,
   *     ignorando cadastros de corretor sem nome (corretores desligados) e os
   *     usuários de sistema (id negativo).
   */
  const linhas = (await sql`
    WITH chave AS (
      SELECT * FROM unnest(${listaChaves}::text[], ${listaDatas}::timestamp[]) AS t(k, ref)
    ),
    cli AS (
      SELECT ch.k, ch.ref, c.id AS cliente_id, c.nome
      FROM chave ch
      JOIN clientes c
        ON right(regexp_replace(COALESCE(c.celular, ''), '\\D', '', 'g'), 9) = ch.k
        OR right(regexp_replace(COALESCE(c.telefone, ''), '\\D', '', 'g'), 9) = ch.k
    ),
    ordem AS (
      SELECT DISTINCT ON (cli.k)
        cli.k, cli.nome AS cliente, l.id AS lead_id, l.empresa_id, l.data_inicio
      FROM cli
      JOIN leads l ON l.cliente_id = cli.cliente_id
      ORDER BY cli.k,
        -- com data de referência: menor distância primeiro; sem ela, tudo NULL
        -- e o desempate cai no critério seguinte (ordem mais recente).
        CASE WHEN cli.ref IS NULL THEN NULL
             ELSE abs(extract(epoch FROM l.data_inicio - cli.ref)) END ASC NULLS LAST,
        l.data_inicio DESC NULLS LAST, l.id DESC
    ),
    resp AS (
      SELECT
        o.k,
        (ARRAY_AGG(r.corretor_id ORDER BY r.data DESC NULLS LAST, r.id DESC))[1] AS atual_id
      FROM ordem o
      JOIN lead_responsaveis r ON r.lead_id = o.lead_id
      JOIN corretores c ON c.id = r.corretor_id
      WHERE r.corretor_id > 0
        AND COALESCE(NULLIF(TRIM(c.nome_comercial), ''), NULLIF(TRIM(c.nome), '')) IS NOT NULL
      GROUP BY o.k
    )
    SELECT
      o.k, o.cliente, o.lead_id, o.empresa_id, o.data_inicio,
      resp.atual_id,
      COALESCE(NULLIF(TRIM(ca.nome_comercial), ''), NULLIF(TRIM(ca.nome), '')) AS atual_nome
    FROM ordem o
    LEFT JOIN resp ON resp.k = o.k
    LEFT JOIN corretores ca ON ca.id = resp.atual_id
  `) as Array<Record<string, unknown>>;

  for (const r of linhas) {
    const k = String(r.k);
    const original = chaves.get(k)?.telefone;
    if (!original) continue;
    saida[original] = {
      telefone: original,
      cliente: (r.cliente as string) ?? null,
      lead_id: (r.lead_id as number) ?? null,
      unidade_id: (r.empresa_id as number) ?? null,
      data_inicio: r.data_inicio ? new Date(r.data_inicio as string).toISOString() : null,
      corretor: (r.atual_nome as string) ?? null,
      corretor_id: (r.atual_id as number) ?? null,
    };
  }

  // Telefones que caíram na mesma chave de 9 dígitos herdam o mesmo resultado.
  for (const q of consultas) {
    if (saida[q.telefone]) continue;
    const k = chaveTelefone(q.telefone);
    const original = k ? chaves.get(k)?.telefone : undefined;
    if (original && original !== q.telefone && saida[original]) saida[q.telefone] = saida[original];
  }

  return saida;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const telefone = req.nextUrl.searchParams.get("telefone");
  if (!telefone) {
    return NextResponse.json(
      { erro: "informe ?telefone=... (ou use POST com { telefones: [...] })" },
      { status: 400 }
    );
  }

  const r = await buscar([{ telefone, data: normalizarData(req.nextUrl.searchParams.get("data")) }]);
  return NextResponse.json(r[telefone] ?? { telefone, corretor: null });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  let body: { telefones?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "body inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.telefones) || body.telefones.length === 0) {
    return NextResponse.json({ erro: "informe { telefones: [...] }" }, { status: 400 });
  }
  if (body.telefones.length > MAX_TELEFONES) {
    return NextResponse.json(
      { erro: `máximo de ${MAX_TELEFONES} telefones por chamada` },
      { status: 400 }
    );
  }

  // Aceita "5512999998888" ou { telefone, data } — a data melhora a escolha da ordem.
  const consultas: Consulta[] = body.telefones.map((item) => {
    if (item && typeof item === "object") {
      const o = item as { telefone?: unknown; data?: unknown };
      return { telefone: String(o.telefone ?? ""), data: normalizarData(o.data) };
    }
    return { telefone: String(item), data: null };
  });

  const resultados = await buscar(consultas);
  const encontrados = Object.values(resultados).filter((r) => r?.corretor).length;
  return NextResponse.json({ total: consultas.length, encontrados, resultados });
}
