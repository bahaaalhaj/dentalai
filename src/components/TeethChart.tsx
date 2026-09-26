import React from 'react';
import { ToothStatus } from '../lib/supabase';
import { cn, TOOTH_COLORS } from '../lib/utils';

interface TeethChartProps {
  status: ToothStatus;
  onToothClick?: (toothId: string) => void;
  interactive?: boolean;
}

export const TeethChart = React.memo(({ status, onToothClick, interactive = false }: TeethChartProps) => {
  // 32 teeth: 1-16 upper, 17-32 lower
  const upperTeeth = Array.from({ length: 16 }, (_, i) => (i + 1).toString());
  const lowerTeeth = Array.from({ length: 16 }, (_, i) => (32 - i).toString());

  const renderTooth = (id: string) => {
    const toothStatus = status[id] || 'healthy';
    const color = TOOTH_COLORS[toothStatus as keyof typeof TOOTH_COLORS] || TOOTH_COLORS.healthy;

    return (
      <div
        key={id}
        onClick={() => interactive && onToothClick?.(id)}
        className={cn(
          "flex flex-col items-center justify-center p-1 border rounded transition-all",
          interactive ? "cursor-pointer hover:bg-slate-100" : ""
        )}
      >
        <span className="text-[10px] font-mono text-slate-400 mb-1">{id}</span>
        <svg width="30" height="40" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M5 10C5 5 10 2 15 2C20 2 25 5 25 10V25C25 30 20 35 15 38C10 35 5 30 5 25V10Z"
            fill={color}
            stroke="#E2E8F0"
            strokeWidth="1"
          />
          {toothStatus === 'cavity' && <circle cx="15" cy="20" r="3" fill="#B91C1C" />}
          {toothStatus === 'filling' && <circle cx="15" cy="15" r="4" fill="#1E40AF" />}
          {toothStatus === 'root_canal' && <rect x="13" y="10" width="4" height="20" fill="#92400E" />}
        </svg>
      </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
      <div className="grid grid-cols-8 gap-2 mb-8">
        {upperTeeth.map(renderTooth)}
      </div>
      <div className="h-px bg-slate-100 w-full mb-8" />
      <div className="grid grid-cols-8 gap-2">
        {lowerTeeth.map(renderTooth)}
      </div>
      
      <div className="mt-8 flex flex-wrap gap-4 justify-center text-xs">
        {Object.entries(TOOTH_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color as string, border: '1px solid #e2e8f0' }} />
            <span className="capitalize text-slate-600">{key.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
