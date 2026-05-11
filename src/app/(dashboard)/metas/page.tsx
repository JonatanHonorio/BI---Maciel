"use client";
import { useState } from "react";
import { useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import { Target, Save } from "lucide-react";

interface Meta {
  id: number;
  mes: string;
  leads_meta: number;
  visitas_meta: number;
  propostas_meta: number;
  vendas_meta: number;
  locacoes_meta: number;
  receita_meta: number;
  budget_meta: number;
  cpl_meta: number;
}

export default function MetasPage() {
  const { data: metas, loading } = useFetch<Meta[]>("/api/metas");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [form, setForm] = useState({
    mes: currentMonth,
    leads_meta: 0,
    visitas_meta: 0,
    propostas_meta: 0,
    vendas_meta: 0,
    locacoes_meta: 0,
    receita_meta: 0,
    budget_meta: 0,
    cpl_meta: 0,
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: Number(value) || 0 }));
  }

  async function handleSave() {
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/metas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setMsg("Metas salvas com sucesso!");
    } else {
      setMsg("Erro ao salvar metas");
    }
    setSaving(false);
  }

  const fields = [
    { key: "leads_meta", label: "Leads", placeholder: "Ex: 500" },
    { key: "visitas_meta", label: "Visitas Agendadas", placeholder: "Ex: 200" },
    { key: "propostas_meta", label: "Propostas", placeholder: "Ex: 50" },
    { key: "vendas_meta", label: "Vendas", placeholder: "Ex: 10" },
    { key: "locacoes_meta", label: "Locações", placeholder: "Ex: 30" },
    { key: "receita_meta", label: "Receita (R$)", placeholder: "Ex: 500000" },
    { key: "budget_meta", label: "Budget Mídia (R$)", placeholder: "Ex: 15000" },
    { key: "cpl_meta", label: "CPL Meta (R$)", placeholder: "Ex: 30" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <Target size={22} /> Metas
      </h2>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Definir Metas do Mês</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-600 mb-1">Mês</label>
          <input
            type="month"
            value={form.mes.substring(0, 7)}
            onChange={(e) => setForm((prev) => ({ ...prev, mes: e.target.value + "-01" }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-gray-600 mb-1">{f.label}</label>
              <input
                type="number"
                value={form[f.key as keyof typeof form] || ""}
                onChange={(e) => updateField(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            <Save size={16} />
            {saving ? "Salvando..." : "Salvar Metas"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.includes("sucesso") ? "text-green-600" : "text-red-600"}`}>
              {msg}
            </span>
          )}
        </div>
      </div>

      {metas && metas.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Histórico de Metas</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Mês</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Leads</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Propostas</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Vendas</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Locações</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Receita</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Budget</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">CPL</th>
                </tr>
              </thead>
              <tbody>
                {metas.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="px-3 py-2">{new Date(m.mes).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(m.leads_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(m.propostas_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(m.vendas_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(m.locacoes_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(m.receita_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(m.budget_meta)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(m.cpl_meta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
