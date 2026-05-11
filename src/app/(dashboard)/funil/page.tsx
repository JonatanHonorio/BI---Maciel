"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import BarChartCard from "@/components/charts/BarChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import { Filter, Users, FileText, Handshake, Thermometer } from "lucide-react";

interface DashboardData {
  leads: { total: number; venda: number; locacao: number };
  propostas: number;
  conversoes: { total: number };
}

interface LeadsData {
  por_corretor: { corretor: string; total: number }[];
  por_temperatura: { temperatura: string; cor: string; total: number }[];
  por_bairro: { bairro: string; total: number }[];
  por_origem: { origem: string; total: number }[];
}

export default function FunilPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<DashboardData>(`/api/dashboard?since=${since}&until=${until}`);
  const { data: leads } = useFetch<LeadsData>(`/api/leads?since=${since}&until=${until}`);

  if (!data || !leads) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const totalLeads = data.leads.total;
  const totalPropostas = data.propostas;
  const totalConversoes = data.conversoes.total;
  const taxaProposta = totalLeads > 0 ? (totalPropostas / totalLeads) * 100 : 0;
  const taxaConversao = totalLeads > 0 ? (totalConversoes / totalLeads) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Funil Comercial</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      {/* Funil Visual */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Filter size={16} /> Funil de Conversão
        </h3>
        <div className="flex flex-col items-center gap-2">
          {[
            { label: "Leads", value: totalLeads, color: "bg-blue-500", width: "100%" },
            { label: "Propostas", value: totalPropostas, color: "bg-purple-500", width: `${Math.max(taxaProposta, 10)}%` },
            { label: "Conversões", value: totalConversoes, color: "bg-green-500", width: `${Math.max(taxaConversao, 5)}%` },
          ].map((step) => (
            <div key={step.label} className="w-full flex items-center gap-3">
              <div className="w-24 text-right text-sm font-medium text-gray-600">{step.label}</div>
              <div className="flex-1 relative">
                <div
                  className={`${step.color} h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm transition-all`}
                  style={{ width: step.width, minWidth: "60px" }}
                >
                  {fmtNum(step.value)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-6 mt-4 justify-center text-sm text-gray-500">
          <span>Lead → Proposta: <strong>{taxaProposta.toFixed(1)}%</strong></span>
          <span>Lead → Conversão: <strong>{taxaConversao.toFixed(1)}%</strong></span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard label="Leads" value={fmtNum(totalLeads)} icon={Users} iconColor="text-blue-500" />
        <KpiCard label="Propostas" value={fmtNum(totalPropostas)} icon={FileText} iconColor="text-purple-500" />
        <KpiCard label="Conversões" value={fmtNum(totalConversoes)} icon={Handshake} iconColor="text-green-500" />
        <KpiCard
          label="Taxa de Conversão"
          value={`${taxaConversao.toFixed(1)}%`}
          icon={Thermometer}
          iconColor="text-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Leads por Corretor"
          data={leads.por_corretor.slice(0, 10)}
          xKey="corretor"
          bars={[{ key: "total", color: "#3b82f6", label: "Leads" }]}
          layout="horizontal"
        />
        <PieChartCard
          title="Leads por Temperatura"
          data={leads.por_temperatura.map((t) => ({
            name: t.temperatura,
            value: Number(t.total),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Leads por Bairro"
          data={leads.por_bairro.slice(0, 10)}
          xKey="bairro"
          bars={[{ key: "total", color: "#10b981", label: "Leads" }]}
          layout="horizontal"
        />
        <PieChartCard
          title="Leads por Canal"
          data={leads.por_origem.slice(0, 8).map((o) => ({
            name: o.origem,
            value: Number(o.total),
          }))}
        />
      </div>
    </div>
  );
}
