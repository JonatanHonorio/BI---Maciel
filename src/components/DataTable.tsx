"use client";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tabela do BI. Mesma API de antes (columns, data, searchable, pageSize) —
 * só o acabamento mudou, e há 8 páginas usando este componente.
 *
 * Decisões visuais que não são enfeite:
 *  - cabeçalho grudento (`sticky`): nas listas de 90 corretores o usuário perde
 *    a referência das colunas ao rolar;
 *  - linhas zebradas em vez de borda por linha: menos ruído com 6 colunas;
 *  - `tabular-nums` nas células numéricas para os dígitos alinharem na vertical.
 */

interface Column {
  key: string;
  label: string;
  format?: (v: unknown) => string;
  align?: "left" | "right" | "center";
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  searchable?: boolean;
  pageSize?: number;
  /** Clique na linha. Sem isto a linha continua sendo texto, como sempre foi. */
  onRowClick?: (row: Record<string, unknown>) => void;
  /**
   * Conteúdo extra logo abaixo da linha. Devolver `null` (o caso comum) não
   * gera nada — é assim que a tabela ganha ação por linha sem que as outras
   * oito telas que usam este componente mudem de comportamento.
   */
  linhaExpandida?: (row: Record<string, unknown>) => ReactNode | null;
}

const alinhamento = (a?: Column["align"]) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

export default function DataTable({
  columns,
  data,
  searchable = false,
  pageSize = 10,
  onRowClick,
  linhaExpandida,
}: DataTableProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = searchable
    ? data.filter((row) =>
        columns.some((col) =>
          String(row[col.key] || "").toLowerCase().includes(search.toLowerCase())
        )
      )
    : data;

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      {searchable && (
        <div className="mb-3 flex justify-end">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="border-input bg-card focus:ring-ring w-52 rounded-md border py-1.5 pr-3 pl-8 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>
      )}

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 sticky top-0">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "text-muted-foreground px-3 py-2.5 text-[11px] font-semibold tracking-wide uppercase",
                    alinhamento(col.align)
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => {
              const extra = linhaExpandida?.(row) ?? null;
              return (
                <Fragment key={i}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "hover:bg-accent/60 transition-colors",
                      i % 2 === 1 && "bg-muted/30",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2.5",
                          alinhamento(col.align),
                          col.align === "right" && "tabular-nums font-medium"
                        )}
                      >
                        {col.format ? col.format(row[col.key]) : String(row[col.key] ?? "-")}
                      </td>
                    ))}
                  </tr>
                  {extra && (
                    <tr className="bg-muted/40">
                      <td colSpan={columns.length} className="px-3 py-3">{extra}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!pageData.length && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-muted-foreground px-3 py-8 text-center text-xs"
                >
                  Nenhum registro no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="text-muted-foreground mt-3 flex items-center justify-between text-xs">
          <span>
            {filtered.length.toLocaleString("pt-BR")} registros
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              aria-label="Página anterior"
              className="border-border hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-1 transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" /> Anterior
            </button>
            <span className="px-2 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              aria-label="Próxima página"
              className="border-border hover:bg-accent flex items-center gap-1 rounded-md border px-2 py-1 transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
              Próximo <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
