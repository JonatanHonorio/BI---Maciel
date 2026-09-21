import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calcularStatusPagamento, ehRubrica, type Papel } from "@/lib/fechamento";
import { pctTexto } from "@/lib/comissao";
import { podeAcessarPeriodo } from "@/lib/permissoes";

interface Rateio {
  corretor_id: number | null; nome: string; papel: Papel; percentual: number | null;
  pagamentos: { valor: number }[];
}

const labelStatus = { pendente: "Pendente", parcial: "Parcial", pago: "Pago" } as const;

/**
 * Gera o .xlsx do período no mesmo espírito do modelo antigo — uma linha por
 * negócio real (QTDE), com Levantamento/Fechamento listando todos os
 * corretores daquele papel (não só 1), já que o rateio aqui é N-a-N.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const periodoId = Number(req.nextUrl.searchParams.get("periodo_id"));
  if (!periodoId) return NextResponse.json({ error: "periodo_id obrigatório" }, { status: 400 });

  const sql = getDb();
  const [periodo] = await sql`SELECT * FROM fechamento_periodos WHERE id = ${periodoId}`;
  if (!periodo) return NextResponse.json({ error: "período não encontrado" }, { status: 404 });

  if (!podeAcessarPeriodo(session, periodo)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  const negocios = (await sql`
    SELECT n.id, n.data_contrato, n.ref, n.contrato, n.endereco, n.origem,
      n.valor, n.comissao, n.pagamento,
      COALESCE(
        json_agg(
          json_build_object('corretor_id', rc.corretor_id, 'nome', COALESCE(NULLIF(TRIM(cor.nome_comercial), ''), NULLIF(TRIM(cor.nome), ''), rc.nome_livre),
            'papel', rc.papel, 'percentual', rc.percentual,
            'pagamentos', COALESCE(pg.pagamentos, '[]'::json))
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('valor', fp.valor)) AS pagamentos
      FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id
    ) pg ON true
    WHERE n.periodo_id = ${periodoId}
    GROUP BY n.id
    ORDER BY n.id
  `) as {
    id: number; data_contrato: string | null; ref: string | null; contrato: string | null;
    endereco: string | null; origem: string | null; valor: string | null; comissao: string | null;
    pagamento: string | null; rateio: Rateio[];
  }[];

  /** Diretoria, Lançamento e Brizola: destinação sem pessoa, num campo só. */
  const rubricasDoNegocio = (rateio: Rateio[]) =>
    rateio
      .filter((r) => ehRubrica(r.papel))
      .map((r) => (r.percentual != null ? `${r.nome} (${pctTexto(Number(r.percentual))})` : r.nome))
      .join(", ");

  const nomesPapel = (rateio: Rateio[], papel: string) =>
    rateio
      .filter((r) => r.papel === papel)
      .map((r) => (r.percentual != null ? `${r.nome} (${pctTexto(Number(r.percentual))})` : r.nome))
      .join(", ");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${periodo.tipo === "venda" ? "Vendas" : "Locação"} - ${periodo.unidade}`);
  ws.addRow([
    "QTDE", "Data Contrato", "Unidade", "Ref", "Contrato", "Endereço",
    "Levantamento", "Fechamento", "Gerência", "Destinações",
    periodo.tipo === "venda" ? "Valor da Venda" : "Valor",
    "Comissão", "Origem", "Pagamento", "Status Pagamento",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  negocios.forEach((n, i) => {
    const pool = periodo.tipo === "venda" ? n.comissao : n.valor;
    const { status } = calcularStatusPagamento(pool, n.rateio);
    ws.addRow([
      i + 1, n.data_contrato, periodo.unidade, n.ref, n.contrato, n.endereco,
      nomesPapel(n.rateio, "levantamento"), nomesPapel(n.rateio, "fechamento"),
      nomesPapel(n.rateio, "gerencia"), rubricasDoNegocio(n.rateio),
      n.valor ? Number(n.valor) : null, n.comissao ? Number(n.comissao) : null,
      n.origem, n.pagamento, labelStatus[status],
    ]);
  });

  ws.getColumn(11).numFmt = "R$ #,##0.00";
  ws.getColumn(12).numFmt = "R$ #,##0.00";
  ws.columns.forEach((c, i) => {
    c.width = [6, 13, 14, 10, 10, 34, 24, 24, 20, 30, 16, 14, 14, 14, 14][i];
  });

  const buffer = await wb.xlsx.writeBuffer();
  // periodo.competencia vem do driver como Date — formatar antes de usar no nome
  // do arquivo (senão vira "Tue Sep 01 2026 00:00:00 GMT-0300 (...)").
  const comp = new Date(periodo.competencia);
  const competenciaFmt = `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, "0")}`;
  const nomeArquivo = `fechamento_${periodo.tipo}_${periodo.unidade}_${competenciaFmt}.xlsx`
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
