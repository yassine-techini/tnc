import { formatDate, formatTime } from '../../lib/formatters';

export interface Session {
  id: string;
  userAgent: string;
  ipAddress: string;
  lastUsed: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface SessionCardProps {
  session: Session;
  onRevoke: (sessionId: string) => void;
  isRevoking?: boolean;
}

/**
 * Parse user agent to get device and browser info
 */
function parseUserAgent(userAgent: string): {
  device: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
} {
  const ua = userAgent.toLowerCase();

  // Detect device type
  let device: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|opera mobi/i.test(ua)) {
    device = 'mobile';
  } else if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) {
    device = 'tablet';
  }

  // Detect browser
  let browser = 'Navigateur inconnu';
  if (ua.includes('chrome') && !ua.includes('edge')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('edge')) {
    browser = 'Edge';
  } else if (ua.includes('opera') || ua.includes('opr')) {
    browser = 'Opera';
  }

  // Detect OS
  let os = 'Système inconnu';
  if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('mac')) {
    os = 'macOS';
  } else if (ua.includes('linux') && !ua.includes('android')) {
    os = 'Linux';
  } else if (ua.includes('android')) {
    os = 'Android';
  } else if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS';
  }

  return { device, browser, os };
}

/**
 * Get device icon based on device type
 */
function DeviceIcon({ device }: { device: 'mobile' | 'tablet' | 'desktop' }) {
  if (device === 'mobile') {
    return (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }

  if (device === 'tablet') {
    return (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }

  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

/**
 * Session Card Component
 */
export function SessionCard({ session, onRevoke, isRevoking = false }: SessionCardProps) {
  const { device, browser, os } = parseUserAgent(session.userAgent);

  return (
    <div
      className={`
        p-4 rounded-lg border transition-all
        ${session.isCurrent
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {/* Device Icon */}
          <div
            className={`
              p-2 rounded-lg
              ${session.isCurrent ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-400'}
            `}
          >
            <DeviceIcon device={device} />
          </div>

          {/* Session Info */}
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">
                {browser} sur {os}
              </p>
              {session.isCurrent && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded-full">
                  Session actuelle
                </span>
              )}
            </div>

            <div className="mt-1 space-y-0.5 text-sm text-slate-400">
              <p className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                {session.ipAddress}
              </p>
              <p className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Dernière activité: {formatDate(session.lastUsed, 'datetime')}
              </p>
              <p className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Connectée le: {formatDate(session.createdAt, 'short')} à {formatTime(session.createdAt)}
              </p>
            </div>
          </div>
        </div>

        {/* Revoke Button */}
        {!session.isCurrent && (
          <button
            onClick={() => onRevoke(session.id)}
            disabled={isRevoking}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-lg transition-all
              ${isRevoking
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
              }
            `}
          >
            {isRevoking ? 'Révocation...' : 'Révoquer'}
          </button>
        )}
      </div>
    </div>
  );
}

export interface SessionListProps {
  sessions: Session[];
  onRevoke: (sessionId: string) => void;
  onRevokeAll: () => void;
  isRevoking?: boolean;
  isRevokingAll?: boolean;
}

/**
 * Session List Component
 */
export function SessionList({
  sessions,
  onRevoke,
  onRevokeAll,
  isRevoking = false,
  isRevokingAll = false,
}: SessionListProps) {
  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Sessions actives</h3>
          <p className="text-sm text-slate-400">
            {sessions.length} session{sessions.length > 1 ? 's' : ''} active{sessions.length > 1 ? 's' : ''}
          </p>
        </div>

        {otherSessions.length > 0 && (
          <button
            onClick={onRevokeAll}
            disabled={isRevokingAll}
            className={`
              px-4 py-2 text-sm font-medium rounded-lg transition-all
              ${isRevokingAll
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'text-red-400 border border-red-400/50 hover:bg-red-500/10'
              }
            `}
          >
            {isRevokingAll ? 'Déconnexion...' : 'Déconnecter tout'}
          </button>
        )}
      </div>

      {/* Session Cards */}
      <div className="space-y-3">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onRevoke={onRevoke}
            isRevoking={isRevoking}
          />
        ))}

        {sessions.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p>Aucune session active</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionCard;
