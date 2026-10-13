import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recebimentosNoPeriodo, escopoUnidade, escopoTipo } from "@/lib/fechamento";
import { podeLancarComissao, unidadesFechamento, tiposFechamento } from "@/lib/permissoes";

const DINHEIRO = "R$ #,##0.00";
const DATA = "dd/mm/yyyy";

/**
 * Excel do caixa da comissão: o que a imobiliária recebeu do cliente numa faixa
 * de datas, em duas abas:
 *
 *   Recebimentos    uma linha por parcela, com a competência de origem ao lado
 *   Por competência o resumo que mostra de quais meses veio o dinheiro
 *
 * Usa `recebimentosNoPeriodo`, a mesma consulta da tela — o Excel não pode
 * mostrar número diferente do que está na tela.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unidades = unidadesFechamento(session);
  const tipos = tiposFechamento(session);
  if (unidades?.length === 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const hoje = new Date();
  const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const valida = (d: string | null) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= "2000-01-01" && d <= "2100-12-31" ? d : null;
  const de = valida(p.get("de")) ?? `${mes}-01`;
  const ate = valida(p.get("ate")) ?? `${mes}-31`;

  const unidadeFiltro = p.get("unidade");
  const tipoFiltro = p.get("tipo");
  const recebimentos = await recebimentosNoPeriodo(
    getDb(), de, ate,
    escopoUnidade(unidades, unidadeFiltro),
    escopoTipo(tipos, tipoFiltro),
  );

  // DATE vem como "YYYY-MM-DD"; `new Date` leria meia-noite UTC e o Excel
  // mostraria o dia anterior no fuso do Brasil.
  const comoData = (s: string) => {
    const [a, m, d] = String(s).slice(0, 10).split("-").map(Number);
    return new Date(a, m - 1, d);
  };

  const wb = new ExcelJS.Workbook();

  // ----------------------------------------------------- aba Recebimentos
  const ws = wb.addWorksheet("Recebimentos");
  ws.addRow([
    "Data do recebimento", "Valor", "Unidade", "Tipo", "Ref", "Contrato",
    "Endereço", "Competência do negócio", "Comissão do negócio", "Observação",
  ]);
  for (const r of recebimentos) {
    ws.addRow([
      comoData(r.data_recebimento), Number(r.valor),
      r.unidade, r.tipo === "venda" ? "Vendas" : "Locação",
      r.ref, r.contrato, r.endereco,
      String(r.competencia).slice(0, 7).split("-").reverse().join("/"),
      r.comissao != null ? Number(r.comissao) : null,
      r.observacao,
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: { row: 1, column: 10 } };
  ws.getColumn(1).numFmt = DATA;
  for (const c of [2, 9]) ws.getColumn(c).numFmt = DINHEIRO;
  ws.columns.forEach((c, i) => { c.width = [20, 16, 14, 10, 10, 12, 40, 22, 18, 30][i]; });

  // --------------------------------------------------- aba Por competência
  const wc = wb.addWorksheet("Por competência");
  wc.addRow(["Competência do negócio", "Parcelas", "Valor recebido no período"]);
  const porComp = new Map<string, { parcelas: number; valor: number }>();
  for (const r of recebimentos) {
    const k = String(r.competencia).slice(0, 7);
    const atual = porComp.get(k) ?? { parcelas: 0, valor: 0 };
    atual.parcelas += 1;
    atual.valor += Number(r.valor);
    porComp.set(k, atual);
  }
  [...porComp.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, v]) => wc.addRow([k.split("-").reverse().join("/"), v.parcelas, v.valor]));
  wc.addRow([]);
  wc.addRow(["TOTAL", recebimentos.length, recebimentos.reduce((s, r) => s + Number(r.valor), 0)]);
  wc.getRow(1).font = { bold: true };
  wc.getRow(wc.rowCount).font = { bold: true };
  wc.views = [{ state: "frozen", ySplit: 1 }];
  wc.getColumn(3).numFmt = DINHEIRO;
  wc.columns.forEach((c, i) => { c.width = [24, 12, 26][i]; });

  const buffer = await wb.xlsx.writeBuffer();
  const sufixo =
    (unidadeFiltro
      ? "_" + unidadeFiltro.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-")
      : "") +
    (tipoFiltro === "venda" ? "_vendas" : tipoFiltro === "locacao" ? "_locacao" : "");
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="recebido_${de}_a_${ate}${sufixo}.xlsx"`,
    },
  });
}
