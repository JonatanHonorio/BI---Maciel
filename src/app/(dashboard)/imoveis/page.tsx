"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import LineChartCard from "@/components/charts/LineChartCard";
import BarChartCard from "@/components/charts/BarChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import DataTable from "@/components/DataTable";
import { Building2, Home, Eye, DollarSign } from "lucide-react";

interface ImoveisData {
  mais_visitados: {
    id: number; codigo: string; titulo: string; tipo_imovel: string;
    bairro: string; cidade: string; valor: number; locacao_venda: string;
    dormitorios: number; visitas: number;
  }[];
  por_tipo: { tipo: string; total: number; valor_medio: number }[];
  por_bairro: { bairro: string; total: number; valor_medio_venda: number; valor_medio_locacao: number }[];
  estoque: { total: number; venda: number; locacao: number; valor_medio: number };
  visitas_por_dia: { dia: string; total: number }[];
}

export default function ImoveisPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<ImoveisData>(`/api/imoveis?since=${since}&until=${until}`);

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
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Estoque Total" value={fmtNum(data.estoque.total)} icon={Building2} iconColor="text-blue-500" />
        <KpiCard label="Venda" value={fmtNum(data.estoque.venda)} icon={Home} iconColor="text-green-500" />
        <KpiCard label="Locação" value={fmtNum(data.estoque.locacao)} icon={Home} iconColor="text-orange-500" />
        <KpiCard label="Valor Médio" value={fmtMoney(data.estoque.valor_medio)} icon={DollarSign} iconColor="text-emerald-500" />
      </div>

      <LineChartCard
        title="Visitas no Site por Dia"
        data={data.visitas_por_dia}
        xKey="dia"
        lines={[{ key: "total", color: "#06b6d4", label: "Visitas" }]}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Eye size={16} /> Imóveis Mais Visitados no Site
        </h3>
        <DataTable
          searchable
          columns={[
            { key: "codigo", label: "Código" },
            { key: "tipo_imovel", label: "Tipo" },
            { key: "bairro", label: "Bairro" },
            { key: "dormitorios", label: "Dorm.", align: "center" },
            { key: "locacao_venda", label: "Op.", align: "center" },
            { key: "valor", label: "Valor", align: "right", format: (v) => fmtMoney(v as number) },
            { key: "visitas", label: "Visitas", align: "right", format: (v) => fmtNum(v as number) },
          ]}
          data={data.mais_visitados}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PieChartCard
          title="Estoque por Tipo"
          data={data.por_tipo.slice(0, 8).map((t) => ({
            name: t.tipo,
            value: Number(t.total),
          }))}
        />
        <BarChartCard
          title="Imóveis por Bairro"
          data={data.por_bairro.slice(0, 10)}
          xKey="bairro"
          bars={[{ key: "total", color: "#8b5cf6", label: "Imóveis" }]}
          layout="horizontal"
        />
      </div>
    </div>
  );
}
