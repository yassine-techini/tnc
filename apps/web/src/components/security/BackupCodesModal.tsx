import { useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface BackupCodesModalProps {
  isOpen: boolean;
  onClose: () => void;
  codes: string[];
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

/**
 * Backup Codes Modal for 2FA recovery
 */
export function BackupCodesModal({
  isOpen,
  onClose,
  codes,
  onRegenerate,
  isRegenerating = false,
}: BackupCodesModalProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Copy codes to clipboard
  const handleCopy = useCallback(async () => {
    const text = codes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy codes:', err);
    }
  }, [codes]);

  // Download codes as text file
  const handleDownload = useCallback(() => {
    const text = `Codes de secours TNC Trading\n${'='.repeat(30)}\n\nCes codes vous permettent de vous connecter si vous perdez votre téléphone.\nChaque code ne peut être utilisé qu'une seule fois.\n\n${codes.map((code, i) => `${i + 1}. ${code}`).join('\n')}\n\n${'='.repeat(30)}\nGénéré le: ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`;

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tnc-trading-codes-secours.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [codes]);

  // Print codes
  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Codes de secours TNC Trading</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            h1 { color: #d97706; margin-bottom: 20px; }
            .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .code { font-family: monospace; font-size: 18px; background: #f3f4f6; padding: 12px; border-radius: 4px; text-align: center; }
            .footer { margin-top: 30px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Codes de secours TNC Trading</h1>
          <div class="warning">
            <strong>Important:</strong> Conservez ces codes dans un endroit sûr. Chaque code ne peut être utilisé qu'une seule fois.
          </div>
          <div class="codes">
            ${codes.map((code) => `<div class="code">${code}</div>`).join('')}
          </div>
          <div class="footer">
            Généré le: ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  }, [codes]);

  // Handle close with acknowledgment check
  const handleClose = useCallback(() => {
    if (acknowledged || codes.length === 0) {
      setAcknowledged(false);
      onClose();
    }
  }, [acknowledged, codes.length, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Codes de secours"
      size="md"
      closeOnOverlayClick={acknowledged || codes.length === 0}
      closeOnEscape={acknowledged || codes.length === 0}
    >
      <div className="space-y-6">
        {/* Warning */}
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex gap-3">
            <svg className="w-6 h-6 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium text-amber-400">Sauvegardez ces codes maintenant</p>
              <p className="text-sm text-slate-400 mt-1">
                Ces codes vous permettent de vous connecter si vous perdez accès à votre application d'authentification.
                Chaque code ne peut être utilisé qu'une seule fois.
              </p>
            </div>
          </div>
        </div>

        {/* Codes Grid */}
        <div className="grid grid-cols-2 gap-2">
          {codes.map((code, index) => (
            <div
              key={index}
              className="p-3 bg-slate-800 rounded-lg text-center font-mono text-lg tracking-wider text-white"
            >
              {code}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            leftIcon={
              copied ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )
            }
          >
            {copied ? 'Copié !' : 'Copier'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleDownload}
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
          >
            Télécharger
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handlePrint}
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            }
          >
            Imprimer
          </Button>

          {onRegenerate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              isLoading={isRegenerating}
              loadingText="Régénération..."
              leftIcon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              Régénérer
            </Button>
          )}
        </div>

        {/* Acknowledgment */}
        <div className="border-t border-slate-700 pt-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
            />
            <span className="text-sm text-slate-300">
              J'ai sauvegardé mes codes de secours dans un endroit sûr et je comprends qu'ils
              sont nécessaires pour récupérer mon compte si je perds mon téléphone.
            </span>
          </label>
        </div>

        {/* Close Button */}
        <Button
          variant="primary"
          fullWidth
          onClick={handleClose}
          disabled={!acknowledged}
        >
          J'ai sauvegardé mes codes
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Backup Codes Display Component (inline, not modal)
 */
export function BackupCodesDisplay({
  codes,
  usedCount = 0,
  onShowCodes,
  onRegenerate,
}: {
  codes?: string[];
  usedCount?: number;
  onShowCodes?: () => void;
  onRegenerate?: () => void;
}) {
  const remainingCodes = codes ? codes.length - usedCount : 0;
  const isLow = remainingCodes <= 3;

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-white">Codes de secours</p>
          <p className={`text-sm ${isLow ? 'text-amber-400' : 'text-slate-400'}`}>
            {codes
              ? `${remainingCodes} code${remainingCodes > 1 ? 's' : ''} restant${remainingCodes > 1 ? 's' : ''}`
              : 'Aucun code généré'}
          </p>
        </div>
        <div className="flex gap-2">
          {codes && codes.length > 0 && onShowCodes && (
            <button
              onClick={onShowCodes}
              className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Voir les codes
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="px-3 py-1.5 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors"
            >
              {codes ? 'Régénérer' : 'Générer'}
            </button>
          )}
        </div>
      </div>

      {isLow && codes && (
        <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-400">
          Il vous reste peu de codes de secours. Pensez à les régénérer.
        </div>
      )}
    </div>
  );
}

export default BackupCodesModal;
