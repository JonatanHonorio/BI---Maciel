"use client";
import { useMemo, useState } from "react";
import { useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import KpiCard from "@/components/KpiCard";
import BarChartCard from "@/components/charts/BarChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import DataTable from "@/components/DataTable";
import { Building2, Home, DollarSign, AlertTriangle, Download } from "lucide-react";

interface ImoveisData {
  por_tipo: { tipo: string; total: number; valor_medio: number }[];
  por_bairro: { bairro: string; total: number; valor_medio_venda: number; valor_medio_locacao: number }[];
  estoque: { total: number; venda: number; locacao: number; valor_medio: number };
  desatualizados: {
    total: number;
    por_unidade: { unidade: string; total: number }[];
    lista: {
      id: number; codigo: string; titulo: string; bairro: string; cidade: string;
      locacao_venda: string; valor: number; dias_sem_atualizar: number;
      captador: string | null; corretor_id: number | null; unidade: string;
    }[];
  };
}

export default function ImoveisPage() {
  /*
   * Sem filtro de data: estoque é FOTO, não período. O seletor que existia
   * aqui só alimentava os gráficos de visita no site, que saíram em 28/09 por
   * falta de dado — mantê-lo deixaria na tela um controle que não muda número
   * nenhum.
   */
  const { data } = useFetch<ImoveisData>("/api/imoveis");
  const [corretorFiltro, setCorretorFiltro] = useState("");

  const captadores = useMemo(() => {
    if (!data) return [];
    const porId = new Map<number, string>();
    for (const d of data.desatualizados.lista) {
      if (d.corretor_id && d.captador) porId.set(d.corretor_id, d.captador);
    }
    return [...porId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const desatualizadosFiltrados = useMemo(() => {
    if (!data) return [];
    if (!corretorFiltro) return data.desatualizados.lista;
    return data.desatualizados.lista.filter((d) => String(d.corretor_id) === corretorFiltro);
  }, [data, corretorFiltro]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Imóveis</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Estoque disponível" value={fmtNum(data.estoque.total)} icon={Building2} iconColor="text-blue-500" />
        <KpiCard label="Venda" value={fmtNum(data.estoque.venda)} icon={Home} iconColor="text-green-500" />
        <KpiCard label="Locação" value={fmtNum(data.estoque.locacao)} icon={Home} iconColor="text-orange-500" />
        <KpiCard label="Valor Médio" value={fmtMoney(data.estoque.valor_medio)} subtitle="do estoque disponível" icon={DollarSign} iconColor="text-emerald-500" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" /> Desatualizados há mais de 90 dias
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {data.desatualizados.total} imóveis sem atualização de cadastro há 90+ dias
          {data.desatualizados.por_unidade.length > 1 && (
            <> — {data.desatualizados.por_unidade.map((u) => `${u.unidade}: ${u.total}`).join(" · ")}</>
          )}
          {data.desatualizados.total > data.desatualizados.lista.length && (
            <> (lista abaixo mostra os {data.desatualizados.lista.length} parados há mais tempo)</>
          )}
        </p>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <select
            value={corretorFiltro}
            onChange={(e) => setCorretorFiltro(e.target.value)}
            className="border-input bg-card rounded-md border py-1.5 px-2.5 text-sm outline-none"
          >
            <option value="">Todos os corretores</option>
            {captadores.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>

          <a
            href={`/api/imoveis/desatualizados-exportar${corretorFiltro ? `?corretor_id=${corretorFiltro}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Download size={14} /> Exportar Excel
          </a>
        </div>

        <DataTable
          searchable
          columns={[
            { key: "codigo", label: "Código" },
            { key: "bairro", label: "Bairro" },
            { key: "unidade", label: "Unidade" },
            { key: "captador", label: "Captador", format: (v) => (v as string) || "—" },
            { key: "locacao_venda", label: "Op.", align: "center" },
            { key: "valor", label: "Valor", align: "right", format: (v) => fmtMoney(v as number) },
            { key: "dias_sem_atualizar", label: "Dias parado", align: "right", format: (v) => fmtNum(v as number) },
          ]}
          data={desatualizadosFiltrados}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PieChartCard
          title="Estoque disponível por tipo"
          data={data.por_tipo.slice(0, 8).map((t) => ({
            name: t.tipo,
            value: Number(t.total),
          }))}
        />
        <BarChartCard
          title="Imóveis disponíveis por bairro"
          data={data.por_bairro.slice(0, 10)}
          xKey="bairro"
          bars={[{ key: "total", color: "#8b5cf6", label: "Imóveis" }]}
          layout="horizontal"
        />
      </div>
    </div>
  );
}
