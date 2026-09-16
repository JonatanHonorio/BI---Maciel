import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade, unidadeDoCorretor, IDS_DIRETORIA } from "@/lib/unidade";

/**
 * Excel dos imóveis desatualizados há 90+ dias, prontos pra mandar pro
 * corretor. Mesmo filtro/escopo de `/api/imoveis` (seção "desatualizados"),
 * só que sem o LIMIT 500 da tela — aqui o gerente já escolheu 1 corretor
 * (ou "todos" dentro da própria unidade), então a lista real nunca chega
 * perto disso.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const corretorIdFiltro = req.nextUrl.searchParams.get("corretor_id");
  const corretorId = corretorIdFiltro ? Number(corretorIdFiltro) : null;

  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);
  const idsExcluirDiretoria = session.role === "admin" ? [] : IDS_DIRETORIA;

  const disponivel = sql`(
    (i.locacao_venda LIKE '%V%' AND i.situacao_codigo_venda = 1) OR
    (i.locacao_venda LIKE '%L%' AND i.situacao_codigo_locacao = 1)
  )`;

  const rows = (await sql`
    WITH captador_principal AS (
      SELECT DISTINCT ON (imovel_id) imovel_id, corretor_id
      FROM imovel_captadores
      WHERE corretor_id != ALL(${idsExcluirDiretoria})
      ORDER BY imovel_id, percentual DESC NULLS LAST, data DESC NULLS LAST
    )
    SELECT
      COALESCE(NULLIF(i.codigo, '0'), LEFT(i.locacao_venda, 1) || i.id::text) AS codigo,
      i.titulo, i.bairro, i.cidade, i.locacao_venda, i.valor,
      EXTRACT(DAY FROM NOW() - i.data_atualizacao)::int AS dias_sem_atualizar,
      cp.corretor_id, u.departamento_id AS dep_captador,
      COALESCE(
        NULLIF(TRIM(u.nome_comercial),''), NULLIF(TRIM(u.nome),''),
        NULLIF(initcap(replace(split_part(COALESCE(u.email,''),'@',1),'.',' ')),'')
      ) AS captador
    FROM imoveis i
    LEFT JOIN captador_principal cp ON cp.imovel_id = i.id
    LEFT JOIN corretores u ON u.id = cp.corretor_id
    WHERE i.data_atualizacao IS NOT NULL
      AND i.data_atualizacao < NOW() - INTERVAL '90 days'
      AND ${disponivel}
      AND (${corretorIds}::int[] IS NULL OR cp.corretor_id = ANY(${corretorIds}::int[]))
      AND (${corretorId}::int IS NULL OR cp.corretor_id = ${corretorId})
    ORDER BY i.data_atualizacao ASC
    LIMIT 3000`) as {
    codigo: string; titulo: string; bairro: string; cidade: string;
    locacao_venda: string; valor: string; dias_sem_atualizar: number;
    corretor_id: number | null; dep_captador: number | null; captador: string | null;
  }[];

  // Só nomeia o arquivo por corretor quando o filtro pediu 1 específico —
  // sem filtro, `rows[0]` seria só o primeiro da lista, não "todos".
  const nomeCorretor = corretorId !== null ? (rows[0]?.captador ?? null) : null;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Desatualizados 90+ dias");
  ws.addRow(["Código", "Bairro", "Cidade", "Unidade", "Captador", "Operação", "Valor", "Dias parado"]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    ws.addRow([
      r.codigo,
      r.bairro,
      r.cidade,
      unidadeDoCorretor(r.corretor_id, r.dep_captador),
      r.captador ?? "—",
      r.locacao_venda,
      Number(r.valor),
      r.dias_sem_atualizar,
    ]);
  }

  ws.getColumn(7).numFmt = "R$ #,##0.00";
  ws.columns.forEach((c, i) => {
    c.width = [12, 22, 18, 14, 28, 10, 16, 12][i];
  });

  const buffer = await wb.xlsx.writeBuffer();

  const slug = (nomeCorretor ?? "todos")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const hoje = new Date().toISOString().slice(0, 10);

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="desatualizados_${slug}_${hoje}.xlsx"`,
    },
  });
}
