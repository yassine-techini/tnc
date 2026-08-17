import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { Button } from '../../components/ui/Button';

/**
 * Vérification de l'adresse email.
 *
 * Cet écran attendait un lien `?token=…`. L'API n'envoie pas de lien : le
 * courriel porte un **code à six chiffres** (`Code de vérification TNC
 * Trading: 123456`), et la route exige `{ email, code }`. Le désaccord n'était
 * donc pas dans la charge utile mais dans le parcours lui-même — l'écran
 * attendait quelque chose qui n'a jamais été envoyé.
 *
 * Il demande maintenant l'email et le code. L'email est pré-rempli quand il
 * arrive en paramètre d'URL, ce qui évite de le retaper après l'inscription.
 */

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [renvoiFait, setRenvoiFait] = useState(false);

  const verifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.verifyEmail(email, code);
      setSucces(true);
    } catch (err) {
      setErreur(
        err instanceof ApiRequestError || err instanceof Error
          ? err.message
          : 'La vérification a échoué'
      );
    } finally {
      setEnCours(false);
    }
  };

  const renvoyer = async () => {
    setErreur('');
    setRenvoiFait(false);
    try {
      await api.resendVerificationEmail(email);
      setRenvoiFait(true);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Le code n'a pas pu être renvoyé");
    }
  };

  if (succes) {
    return (
      <div className="max-w-md mx-auto card text-center space-y-4">
        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-white">Adresse vérifiée</h1>
        <p className="text-sm text-slate-400">Vous pouvez maintenant vous connecter.</p>
        <Link to="/login" className="btn-primary inline-block">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto card space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Vérification de l'email</h1>
        <p className="text-sm text-slate-400 mt-1">
          Saisissez le code à six chiffres reçu par email.
        </p>
      </div>

      {erreur && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          {erreur}
        </div>
      )}

      {renvoiFait && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-300">
          Un nouveau code vient d'être envoyé.
        </div>
      )}

      <form onSubmit={verifier} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="verif-email">
            Adresse email
          </label>
          <input
            id="verif-email"
            className="input w-full"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2" htmlFor="verif-code">
            Code de vérification
          </label>
          <input
            id="verif-code"
            className="input w-full tracking-[0.4em] text-center"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            required
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={enCours}
          disabled={!email || code.length !== 6}
        >
          Vérifier
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-slate-400 underline" onClick={renvoyer} disabled={!email}>
          Renvoyer le code
        </button>
        <Link to="/login" className="text-slate-400 underline">
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
