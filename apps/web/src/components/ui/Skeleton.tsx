/**
 * Skeleton loading components for better UX
 */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-slate-700 rounded ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card space-y-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="card">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-10 w-32 mb-1" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 pb-3 border-b border-slate-700">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          {[1, 2, 3, 4].map((j) => (
            <Skeleton key={j} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="relative h-[300px] bg-slate-800/50 rounded-lg overflow-hidden">
      <div className="absolute inset-0 flex items-end justify-around p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="w-6"
            style={{ height: `${Math.random() * 60 + 20}%` }}
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

export function SkeletonTransactionRow() {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-20 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="text-right">
        <Skeleton className="h-4 w-16 mb-1 ml-auto" />
        <Skeleton className="h-3 w-12 ml-auto" />
      </div>
    </div>
  );
}
