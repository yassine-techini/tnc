import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';

type DocumentType = 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';
type KycStep = 'info' | 'document-type' | 'document-upload' | 'selfie' | 'review' | 'submitted';

interface KycFormData {
  documentType: DocumentType;
  documentNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  frontImage: string;
  backImage: string;
  selfieImage: string;
}

interface KycStatus {
  level: 'BASIC' | 'STANDARD' | 'VERIFIED';
  status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason?: string;
  submittedAt?: string;
}

const documentTypes: { value: DocumentType; label: string; hasBack: boolean }[] = [
  { value: 'CNIB', label: 'Carte Nationale d\'Identité Burkinabè', hasBack: true },
  { value: 'PASSPORT', label: 'Passeport', hasBack: false },
  { value: 'CEDEAO', label: 'Carte d\'identité CEDEAO', hasBack: true },
  { value: 'PERMIT', label: 'Permis de conduire', hasBack: true },
];

export default function KYC() {
  const { user, tokens, updateUser } = useAuthStore();
  const [step, setStep] = useState<KycStep>('info');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [formData, setFormData] = useState<KycFormData>({
    documentType: 'CNIB',
    documentNumber: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    frontImage: '',
    backImage: '',
    selfieImage: '',
  });

  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  // Fetch KYC status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      if (!tokens?.accessToken) return;
      try {
        const response = await api.getKycStatus(tokens.accessToken);
        setKycStatus(response.data);
        if (response.data.status === 'SUBMITTED') {
          setStep('submitted');
        }
      } catch {
        // Ignore - might not have KYC submission yet
      }
    };
    fetchStatus();
  }, [tokens?.accessToken]);

  const selectedDocType = documentTypes.find(d => d.value === formData.documentType);

  const handleFileUpload = useCallback(async (file: File, type: 'front' | 'back' | 'selfie') => {
    if (!tokens?.accessToken) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      setError('Veuillez sélectionner une image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('L\'image doit faire moins de 10 Mo');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await api.uploadKycDocument(file, tokens.accessToken);
      const field = type === 'front' ? 'frontImage' : type === 'back' ? 'backImage' : 'selfieImage';
      setFormData(prev => ({ ...prev, [field]: response.data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du téléchargément');
    } finally {
      setIsLoading(false);
    }
  }, [tokens?.accessToken]);

  const handleSubmit = async () => {
    if (!tokens?.accessToken) return;
    setIsLoading(true);
    setError('');

    try {
      await api.submitKyc({
        documentType: formData.documentType,
        documentNumber: formData.documentNumber,
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth,
        frontImage: formData.frontImage,
        backImage: selectedDocType?.hasBack ? formData.backImage : undefined,
        selfieImage: formData.selfieImage,
      }, tokens.accessToken);

      updateUser({ kycStatus: 'SUBMITTED' });
      setStep('submitted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la soumission');
    } finally {
      setIsLoading(false);
    }
  };

  const canProceedFromInfo = formData.firstName && formData.lastName && formData.dateOfBirth;
  const canProceedFromDocument = formData.frontImage && (!selectedDocType?.hasBack || formData.backImage) && formData.documentNumber;
  const canProceedFromSelfie = formData.selfieImage;

  // Show status if already submitted
  if (kycStatus?.status === 'SUBMITTED' || step === 'submitted') {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Vérification KYC</h1>
        <div className="card text-center">
          <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-yellow-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Vérification en cours</h2>
          <p className="text-slate-400 mb-6">
            Votre demande est en cours de vérification. Vous recevrez une notification une fois la vérification terminée.
          </p>
          <div className="p-4 bg-slate-800/40 rounded-xl text-sm">
            <p className="text-slate-400">
              Délai de traitement: <span className="text-white font-medium">24-48 heures</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show rejection status with option to resubmit
  if (kycStatus?.status === 'REJECTED') {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Vérification KYC</h1>
        <div className="card">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-center mb-2">Vérification refusée</h2>
          <p className="text-slate-400 text-center mb-4">
            Votre demande de vérification a été refusée.
          </p>
          {kycStatus.rejectionReason && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg mb-6">
              <p className="text-sm text-red-400">
                <span className="font-medium">Raison:</span> {kycStatus.rejectionReason}
              </p>
            </div>
          )}
          <Button
            variant="primary"
            fullWidth
            onClick={() => {
              setKycStatus(null);
              setStep('info');
              setFormData({
                documentType: 'CNIB',
                documentNumber: '',
                firstName: '',
                lastName: '',
                dateOfBirth: '',
                frontImage: '',
                backImage: '',
                selfieImage: '',
              });
            }}
          >
            Soumettre une nouvelle demande
          </Button>
        </div>
      </div>
    );
  }

  // Show vérifiéd status
  if (user?.kycLevel === 'VERIFIED' || kycStatus?.status === 'APPROVED') {
    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Vérification KYC</h1>
        <div className="card text-center">
          <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Compte vérifié</h2>
          <p className="text-slate-400 mb-6">
            Votre identité a été vérifiée. Vous avez accès à toutes les fonctionnalités de TNC Trading.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/15 rounded-xl">
            <span className="text-emerald-400 font-medium">Niveau: VERIFIED</span>
          </div>
        </div>
        <KycLimitsCard currentLevel={user?.kycLevel} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white tracking-tight">Vérification KYC</h1>

      {/* Progress indicator */}
      <div className="flex items-center justify-between px-4">
        {['info', 'document-type', 'document-upload', 'selfie', 'review'].map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === s ? 'bg-gold-500 text-black' :
              ['info', 'document-type', 'document-upload', 'selfie', 'review'].indexOf(step) > i
                ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'
            }`}>
              {['info', 'document-type', 'document-upload', 'selfie', 'review'].indexOf(step) > i ? '✓' : i + 1}
            </div>
            {i < 4 && <div className={`w-12 h-1 ${
              ['info', 'document-type', 'document-upload', 'selfie', 'review'].indexOf(step) > i
                ? 'bg-emerald-500' : 'bg-slate-700'
            }`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Personal Info */}
      {step === 'info' && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-6">Informations personnelles</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Prénom</label>
                <input
                  type="text"
                  className="input"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="Jean"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Nom</label>
                <input
                  type="text"
                  className="input"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Ouedraogo"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Date de naissance</label>
              <input
                type="date"
                className="input"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
              />
              <p className="text-xs text-slate-400 mt-1">Vous devez avoir au moins 18 ans</p>
            </div>
            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => setStep('document-type')}
              disabled={!canProceedFromInfo}
              className="mt-4"
            >
              Continuer
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Document Type */}
      {step === 'document-type' && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-6">Type de document</h2>
          <div className="space-y-3">
            {documentTypes.map((doc) => (
              <label
                key={doc.value}
                className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-colors ${
                  formData.documentType === doc.value
                    ? 'bg-gold-500/20 border-2 border-gold-500'
                    : 'bg-slate-900/50 border-2 border-transparent hover:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="documentType"
                  value={doc.value}
                  checked={formData.documentType === doc.value}
                  onChange={(e) => setFormData({ ...formData, documentType: e.target.value as DocumentType })}
                  className="w-4 h-4 accent-gold-500"
                />
                <span>{doc.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep('info')}>
              Retour
            </Button>
            <Button variant="primary" size="lg" className="flex-1" onClick={() => setStep('document-upload')}>
              Continuer
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Document Upload */}
      {step === 'document-upload' && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-6">Photo du document</h2>
          <p className="text-sm text-slate-400 mb-4">
            Prenez une photo claire de votre {selectedDocType?.label.toLowerCase()}. Assurez-vous que toutes les informations sont lisibles.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Numéro du document</label>
              <input
                type="text"
                className="input"
                value={formData.documentNumber}
                onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })}
                placeholder="B12345678"
              />
            </div>

            {/* Front image */}
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                {selectedDocType?.hasBack ? 'Recto du document' : 'Photo du document'}
              </label>
              <input
                type="file"
                ref={frontInputRef}
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, 'front');
                }}
              />
              {formData.frontImage ? (
                <div className="relative">
                  <img
                    src={formData.frontImage}
                    alt="Recto"
                    className="w-full h-48 object-cover rounded-lg"
                  />
                  <button
                    onClick={() => setFormData({ ...formData, frontImage: '' })}
                    className="absolute top-2 right-2 p-1 bg-red-500 rounded-full"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => frontInputRef.current?.click()}
                  disabled={isLoading}
                  className="w-full h-32 border-2 border-dashed border-slate-600 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-gold-500 transition-colors"
                >
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm text-slate-400">
                    {isLoading ? 'Téléchargement...' : 'Prendre une photo ou importer'}
                  </span>
                </button>
              )}
            </div>

            {/* Back image (if needed) */}
            {selectedDocType?.hasBack && (
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Verso du document</label>
                <input
                  type="file"
                  ref={backInputRef}
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'back');
                  }}
                />
                {formData.backImage ? (
                  <div className="relative">
                    <img
                      src={formData.backImage}
                      alt="Verso"
                      className="w-full h-48 object-cover rounded-lg"
                    />
                    <button
                      onClick={() => setFormData({ ...formData, backImage: '' })}
                      className="absolute top-2 right-2 p-1 bg-red-500 rounded-full"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => backInputRef.current?.click()}
                    disabled={isLoading}
                    className="w-full h-32 border-2 border-dashed border-slate-600 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-gold-500 transition-colors"
                  >
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm text-slate-400">
                      {isLoading ? 'Téléchargement...' : 'Prendre une photo ou importer'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep('document-type')}>
              Retour
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => setStep('selfie')}
              disabled={!canProceedFromDocument}
            >
              Continuer
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Selfie */}
      {step === 'selfie' && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-6">Selfie de vérification</h2>
          <p className="text-sm text-slate-400 mb-4">
            Prenez un selfie de votre visage. Assurez-vous que votre visage est bien éclairé et visible.
          </p>

          <div className="space-y-4">
            <input
              type="file"
              ref={selfieInputRef}
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file, 'selfie');
              }}
            />
            {formData.selfieImage ? (
              <div className="relative">
                <img
                  src={formData.selfieImage}
                  alt="Selfie"
                  className="w-full h-64 object-cover rounded-lg"
                />
                <button
                  onClick={() => setFormData({ ...formData, selfieImage: '' })}
                  className="absolute top-2 right-2 p-1 bg-red-500 rounded-full"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => selfieInputRef.current?.click()}
                disabled={isLoading}
                className="w-full h-48 border-2 border-dashed border-slate-600 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-gold-500 transition-colors"
              >
                <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-slate-400">
                  {isLoading ? 'Téléchargement...' : 'Prendre un selfie'}
                </span>
              </button>
            )}

            <div className="p-4 bg-slate-800/40 rounded-xl text-sm">
              <p className="font-medium mb-2">Conseils pour un bon selfie:</p>
              <ul className="text-slate-400 space-y-1 list-disc list-inside">
                <li>Regardez directement la caméra</li>
                <li>Assurez un bon éclairage</li>
                <li>Ne portez pas de lunettes de soleil</li>
                <li>Gardez une expression neutre</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep('document-upload')}>
              Retour
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => setStep('review')}
              disabled={!canProceedFromSelfie}
            >
              Continuer
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Review */}
      {step === 'review' && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-6">Vérification des informations</h2>
          <p className="text-sm text-slate-400 mb-4">
            Vérifiez que toutes les informations sont correctes avant de soumettre.
          </p>

          <div className="space-y-4">
            <div className="p-4 bg-slate-800/40 rounded-xl">
              <h3 className="font-medium mb-2">Informations personnelles</h3>
              <div className="text-sm text-slate-400 space-y-1">
                <p>Nom complet: <span className="text-white">{formData.firstName} {formData.lastName}</span></p>
                <p>Date de naissance: <span className="text-white">{new Date(formData.dateOfBirth).toLocaleDateString('fr-FR')}</span></p>
              </div>
            </div>

            <div className="p-4 bg-slate-800/40 rounded-xl">
              <h3 className="font-medium mb-2">Document d'identité</h3>
              <div className="text-sm text-slate-400 space-y-1">
                <p>Type: <span className="text-white">{selectedDocType?.label}</span></p>
                <p>Numéro: <span className="text-white">{formData.documentNumber}</span></p>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <img src={formData.frontImage} alt="Recto" className="h-24 object-cover rounded" />
                {formData.backImage && (
                  <img src={formData.backImage} alt="Verso" className="h-24 object-cover rounded" />
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-800/40 rounded-xl">
              <h3 className="font-medium mb-2">Selfie</h3>
              <img src={formData.selfieImage} alt="Selfie" className="h-32 object-cover rounded" />
            </div>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm">
              <p className="text-yellow-400">
                En soumettant ce formulaire, je certifie que les informations fournies sont exactes et que les documents m'appartiennent.
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStep('selfie')}>
              Retour
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={handleSubmit}
              isLoading={isLoading}
              loadingText="Soumission..."
            >
              Soumettre ma demande
            </Button>
          </div>
        </div>
      )}

      {/* KYC Limits Info */}
      {step === 'info' && <KycLimitsCard currentLevel={user?.kycLevel} />}
    </div>
  );
}

function KycLimitsCard({ currentLevel }: { currentLevel?: string }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white mb-4">Limites par niveau</h2>
      <div className="space-y-4">
        <div className="p-4 bg-slate-800/40 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">BASIC</span>
            {currentLevel === 'BASIC' && (
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">Actuel</span>
            )}
          </div>
          <p className="text-sm text-slate-400">Consultation uniquement - Achat/Vente non autorisé</p>
        </div>
        <div className="p-4 bg-slate-800/40 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">STANDARD</span>
            {currentLevel === 'STANDARD' && (
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">Actuel</span>
            )}
          </div>
          <p className="text-sm text-slate-400">100g/jour - 500g/mois - Retrait: 500,000 FCFA/jour</p>
        </div>
        <div className="p-4 bg-slate-800/40 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">VERIFIED</span>
            {currentLevel === 'VERIFIED' && (
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Actuel</span>
            )}
          </div>
          <p className="text-sm text-slate-400">1000g/jour - 5000g/mois - Retrait: 5,000,000 FCFA/jour</p>
        </div>
      </div>
    </div>
  );
}
