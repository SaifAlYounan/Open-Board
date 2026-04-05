import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  subvalue?: string;
  color?: string;
  testId?: string;
}

export function StatCard({ label, value, subvalue, color = '#0071e3', testId }: StatCardProps) {
  return (
    <div
      className="bg-white rounded-2xl p-6 border border-[#e5e5e7]"
      data-testid={testId}
    >
      <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-2">{label}</div>
      <div className="text-3xl font-semibold" style={{ color }}>
        {value ?? '—'}
      </div>
      {subvalue && <div className="text-xs text-[#86868b] mt-1">{subvalue}</div>}
    </div>
  );
}
