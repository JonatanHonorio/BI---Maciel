"use client";

interface DateFilterProps {
  since: string;
  until: string;
  onSinceChange: (v: string) => void;
  onUntilChange: (v: string) => void;
  onPreset: (p: string) => void;
}

const presets = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "mtd", label: "MTD" },
];

export default function DateFilter({
  since,
  until,
  onSinceChange,
  onUntilChange,
  onPreset,
}: DateFilterProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="date"
        value={since}
        onChange={(e) => onSinceChange(e.target.value)}
        className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
      />
      <span className="text-gray-400 text-sm">a</span>
      <input
        type="date"
        value={until}
        onChange={(e) => onUntilChange(e.target.value)}
        className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
      />
      <div className="flex gap-1 ml-2">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => onPreset(p.key)}
            className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-blue-100 hover:text-blue-700 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
