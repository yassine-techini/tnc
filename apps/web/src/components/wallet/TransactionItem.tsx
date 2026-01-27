import { formatCurrency, formatGrams, formatDate, truncateId } from '../../lib/formatters';
import { TRANSACTION_TYPES, TRANSACTION_STATUS, type TransactionType, type TransactionStatus } from '../../lib/constants';

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  tokenAmount?: number;
  cashAmount: number;
  pricePerGram?: number;
  fees?: number;
  paymentMethod?: string;
  paymentReference?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TransactionItemProps {
  transaction: Transaction;
  onClick?: (transaction: Transaction) => void;
  showDetails?: boolean;
}

/**
 * Get icon for transaction type
 */
function TransactionIcon({ type }: { type: TransactionType }) {
  const config = TRANSACTION_TYPES[type];

  const iconClasses = `w-5 h-5 ${
    config.color === 'green' ? 'text-green-400' :
    config.color === 'red' ? 'text-red-400' :
    config.color === 'blue' ? 'text-blue-400' :
    config.color === 'yellow' ? 'text-yellow-400' :
    'text-slate-400'
  }`;

  switch (type) {
    case 'BUY':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    case 'SELL':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'DEPOSIT':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      );
    case 'WITHDRAWAL':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      );
    case 'FEE':
      return (
        <svg className={iconClasses} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Transaction Item Component
 */
export function TransactionItem({
  transaction,
  onClick,
  showDetails = false,
}: TransactionItemProps) {
  const typeConfig = TRANSACTION_TYPES[transaction.type];
  const statusConfig = TRANSACTION_STATUS[transaction.status];

  const isPositive = transaction.type === 'DEPOSIT' || transaction.type === 'SELL';
  const amountSign = isPositive ? '+' : '-';

  return (
    <div
      onClick={() => onClick?.(transaction)}
      className={`
        p-4 rounded-lg bg-slate-800/50 border border-slate-700
        transition-all
        ${onClick ? 'cursor-pointer hover:bg-slate-800 hover:border-slate-600' : ''}
      `}
    >
      <div className="flex items-center justify-between">
        {/* Left: Icon and Info */}
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div
            className={`
              p-2.5 rounded-lg
              ${typeConfig.color === 'green' ? 'bg-green-500/20' :
                typeConfig.color === 'red' ? 'bg-red-500/20' :
                typeConfig.color === 'blue' ? 'bg-blue-500/20' :
                typeConfig.color === 'yellow' ? 'bg-yellow-500/20' :
                'bg-slate-700'
              }
            `}
          >
            <TransactionIcon type={transaction.type} />
          </div>

          {/* Details */}
          <div>
            <p className="font-medium text-white">
              {typeConfig.label}
              {transaction.tokenAmount && (
                <span className="text-slate-400 font-normal ml-1">
                  • {formatGrams(transaction.tokenAmount)}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>{formatDate(transaction.createdAt, 'datetime')}</span>
              <span>•</span>
              <span className={statusConfig.color}>{statusConfig.label}</span>
            </div>
          </div>
        </div>

        {/* Right: Amount */}
        <div className="text-right">
          <p
            className={`
              font-semibold
              ${isPositive ? 'text-green-400' : 'text-white'}
            `}
          >
            {amountSign}{formatCurrency(transaction.cashAmount, 'XOF')}
          </p>
          {transaction.pricePerGram && (
            <p className="text-sm text-slate-400">
              @ {formatCurrency(transaction.pricePerGram, 'XOF')}/g
            </p>
          )}
        </div>
      </div>

      {/* Additional Details (expanded) */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-slate-700 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Reference</span>
            <span className="font-mono text-white">{truncateId(transaction.id)}</span>
          </div>
          {transaction.fees && transaction.fees > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">Frais</span>
              <span className="text-white">{formatCurrency(transaction.fees, 'XOF')}</span>
            </div>
          )}
          {transaction.paymentMethod && (
            <div className="flex justify-between">
              <span className="text-slate-400">Methode de paiement</span>
              <span className="text-white">{transaction.paymentMethod}</span>
            </div>
          )}
          {transaction.completedAt && (
            <div className="flex justify-between">
              <span className="text-slate-400">Complete le</span>
              <span className="text-white">{formatDate(transaction.completedAt, 'datetime')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface TransactionListProps {
  transactions: Transaction[];
  onTransactionClick?: (transaction: Transaction) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

/**
 * Transaction List Component
 */
export function TransactionList({
  transactions,
  onTransactionClick,
  isLoading = false,
  emptyMessage = 'Aucune transaction',
  showLoadMore = false,
  onLoadMore,
  isLoadingMore = false,
}: TransactionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-4 rounded-lg bg-slate-800/50 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-700" />
              <div className="flex-1">
                <div className="h-4 bg-slate-700 rounded w-32 mb-2" />
                <div className="h-3 bg-slate-700 rounded w-48" />
              </div>
              <div className="text-right">
                <div className="h-4 bg-slate-700 rounded w-24 mb-2" />
                <div className="h-3 bg-slate-700 rounded w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-lg">{emptyMessage}</p>
        <p className="text-sm mt-1">Les transactions apparaitront ici</p>
      </div>
    );
  }

  // Group transactions by date
  const groupedTransactions = transactions.reduce((groups, transaction) => {
    const date = new Date(transaction.createdAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(transaction);
    return groups;
  }, {} as Record<string, Transaction[]>);

  return (
    <div className="space-y-6">
      {Object.entries(groupedTransactions).map(([date, dateTransactions]) => (
        <div key={date}>
          <p className="text-sm font-medium text-slate-400 mb-3">{date}</p>
          <div className="space-y-3">
            {dateTransactions.map((transaction) => (
              <TransactionItem
                key={transaction.id}
                transaction={transaction}
                onClick={onTransactionClick}
              />
            ))}
          </div>
        </div>
      ))}

      {showLoadMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-full py-3 text-center text-slate-400 hover:text-white transition-colors"
        >
          {isLoadingMore ? 'Chargement...' : 'Charger plus'}
        </button>
      )}
    </div>
  );
}

/**
 * Transaction Summary Stats
 */
export function TransactionStats({
  totalBuy,
  totalSell,
  totalDeposits,
  totalWithdrawals,
}: {
  totalBuy: number;
  totalSell: number;
  totalDeposits: number;
  totalWithdrawals: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
        <p className="text-sm text-slate-400">Total achats</p>
        <p className="text-lg font-semibold text-green-400">{formatCurrency(totalBuy, 'XOF')}</p>
      </div>
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-sm text-slate-400">Total ventes</p>
        <p className="text-lg font-semibold text-red-400">{formatCurrency(totalSell, 'XOF')}</p>
      </div>
      <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-slate-400">Total depots</p>
        <p className="text-lg font-semibold text-blue-400">{formatCurrency(totalDeposits, 'XOF')}</p>
      </div>
      <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <p className="text-sm text-slate-400">Total retraits</p>
        <p className="text-lg font-semibold text-yellow-400">{formatCurrency(totalWithdrawals, 'XOF')}</p>
      </div>
    </div>
  );
}

export default TransactionItem;
