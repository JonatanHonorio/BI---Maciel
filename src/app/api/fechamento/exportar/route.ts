import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calcularStatusPagamento, type Papel } from "@/lib/fechamento";
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
      n.valor, n.comissao, n.pagamento, n.cancelado,
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
    cancelado: boolean;
    pagamento: string | null; rateio: Rateio[];
  }[];

  const nomesPapel = (rateio: Rateio[], papel: string) =>
    rateio
      .filter((r) => r.papel === papel)
      .map((r) => (r.percentual != null ? `${r.nome} (${pctTexto(Number(r.percentual))})` : r.nome))
      .join(", ");

  const ehVenda = periodo.tipo === "venda";

  /**
   * Uma lista só descreve a coluna inteira — título, largura, formato e de
   * onde sai o valor.
   *
   * Antes eram três arrays paralelos (cabeçalho, linha, larguras) e os índices
   * de `numFmt` escritos na mão. Tirar uma coluna obrigava a contar posição em
   * quatro lugares, e a conta errada não quebra nada: só desalinha a planilha.
   */
  interface Coluna {
    titulo: string;
    largura: number;
    dinheiro?: boolean;
    valor: (n: (typeof negocios)[number], i: number, status: string) => unknown;
  }

  const colunas: Coluna[] = [
    { titulo: "QTDE", largura: 6, valor: (_n, i) => i + 1 },
    { titulo: "Data Contrato", largura: 13, valor: (n) => n.data_contrato },
    { titulo: "Unidade", largura: 14, valor: () => periodo.unidade },
    { titulo: "Ref", largura: 10, valor: (n) => n.ref },
    { titulo: "Contrato", largura: 10, valor: (n) => n.contrato },
    { titulo: "Endereço", largura: 34, valor: (n) => n.endereco },
    { titulo: "Levantamento", largura: 24, valor: (n) => nomesPapel(n.rateio, "levantamento") },
    { titulo: "Fechamento", largura: 24, valor: (n) => nomesPapel(n.rateio, "fechamento") },
    // Venda cancelada entra na planilha com a marca e SEM valor: a linha
    // continua sendo a prova de que o negócio existiu, mas somar a coluna não
    // pode devolver dinheiro que a imobiliária não recebeu.
    { titulo: "Situação", largura: 12, valor: (n) => (n.cancelado ? "CANCELADA" : "") },
    {
      titulo: ehVenda ? "Valor da Venda" : "Valor", largura: 16, dinheiro: true,
      valor: (n) => (n.cancelado || !n.valor ? null : Number(n.valor)),
    },
    // Comissão, Pagamento e Status Pagamento saem da locação (pedido do
    // Jonatan em 22/09): locação não tem campo de comissão — o que a
    // imobiliária recebe já é o próprio Valor — e a forma de pagamento é
    // coisa de venda (Financiamento, FGTS, Consórcio).
    ...(ehVenda
      ? [{
          titulo: "Comissão", largura: 14, dinheiro: true,
          valor: (n: (typeof negocios)[number]) => (n.cancelado || !n.comissao ? null : Number(n.comissao)),
        }]
      : []),
    { titulo: "Origem", largura: 14, valor: (n) => n.origem },
    ...(ehVenda
      ? [
          { titulo: "Pagamento", largura: 14, valor: (n: (typeof negocios)[number]) => n.pagamento },
          { titulo: "Status Pagamento", largura: 14, valor: (_n: (typeof negocios)[number], _i: number, status: string) => status },
        ]
      : []),
  ];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${ehVenda ? "Vendas" : "Locação"} - ${periodo.unidade}`);
  ws.addRow(colunas.map((c) => c.titulo));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  negocios.forEach((n, i) => {
    const pool = ehVenda ? n.comissao : n.valor;
    const { status } = calcularStatusPagamento(pool, n.rateio);
    ws.addRow(colunas.map((c) => c.valor(n, i, labelStatus[status])));
  });

  colunas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.largura;
    if (c.dinheiro) col.numFmt = "R$ #,##0.00";
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
