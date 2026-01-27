import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

// Liste complète des pays du monde
const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan' },
  { code: 'ZA', name: 'Afrique du Sud' },
  { code: 'AL', name: 'Albanie' },
  { code: 'DZ', name: 'Algérie' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'AD', name: 'Andorre' },
  { code: 'AO', name: 'Angola' },
  { code: 'AG', name: 'Antigua-et-Barbuda' },
  { code: 'SA', name: 'Arabie Saoudite' },
  { code: 'AR', name: 'Argentine' },
  { code: 'AM', name: 'Arménie' },
  { code: 'AU', name: 'Australie' },
  { code: 'AT', name: 'Autriche' },
  { code: 'AZ', name: 'Azerbaïdjan' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahreïn' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BB', name: 'Barbade' },
  { code: 'BE', name: 'Belgique' },
  { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Bénin' },
  { code: 'BT', name: 'Bhoutan' },
  { code: 'BY', name: 'Biélorussie' },
  { code: 'MM', name: 'Birmanie' },
  { code: 'BO', name: 'Bolivie' },
  { code: 'BA', name: 'Bosnie-Herzégovine' },
  { code: 'BW', name: 'Botswana' },
  { code: 'BR', name: 'Brésil' },
  { code: 'BN', name: 'Brunei' },
  { code: 'BG', name: 'Bulgarie' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'KH', name: 'Cambodge' },
  { code: 'CM', name: 'Cameroun' },
  { code: 'CA', name: 'Canada' },
  { code: 'CV', name: 'Cap-Vert' },
  { code: 'CF', name: 'Centrafrique' },
  { code: 'CL', name: 'Chili' },
  { code: 'CN', name: 'Chine' },
  { code: 'CY', name: 'Chypre' },
  { code: 'CO', name: 'Colombie' },
  { code: 'KM', name: 'Comores' },
  { code: 'KR', name: 'Corée du Sud' },
  { code: 'KP', name: 'Corée du Nord' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'HR', name: 'Croatie' },
  { code: 'CU', name: 'Cuba' },
  { code: 'DK', name: 'Danemark' },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominique' },
  { code: 'EG', name: 'Égypte' },
  { code: 'AE', name: 'Émirats Arabes Unis' },
  { code: 'EC', name: 'Équateur' },
  { code: 'ER', name: 'Érythrée' },
  { code: 'ES', name: 'Espagne' },
  { code: 'EE', name: 'Estonie' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'US', name: 'États-Unis' },
  { code: 'ET', name: 'Éthiopie' },
  { code: 'FJ', name: 'Fidji' },
  { code: 'FI', name: 'Finlande' },
  { code: 'FR', name: 'France' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambie' },
  { code: 'GE', name: 'Géorgie' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Grèce' },
  { code: 'GD', name: 'Grenade' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GN', name: 'Guinée' },
  { code: 'GW', name: 'Guinée-Bissau' },
  { code: 'GQ', name: 'Guinée équatoriale' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haïti' },
  { code: 'HN', name: 'Honduras' },
  { code: 'HU', name: 'Hongrie' },
  { code: 'IN', name: 'Inde' },
  { code: 'ID', name: 'Indonésie' },
  { code: 'IQ', name: 'Irak' },
  { code: 'IR', name: 'Iran' },
  { code: 'IE', name: 'Irlande' },
  { code: 'IS', name: 'Islande' },
  { code: 'IL', name: 'Israël' },
  { code: 'IT', name: 'Italie' },
  { code: 'JM', name: 'Jamaïque' },
  { code: 'JP', name: 'Japon' },
  { code: 'JO', name: 'Jordanie' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KG', name: 'Kirghizistan' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KW', name: 'Koweït' },
  { code: 'LA', name: 'Laos' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LV', name: 'Lettonie' },
  { code: 'LB', name: 'Liban' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libye' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lituanie' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MK', name: 'Macédoine du Nord' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MY', name: 'Malaisie' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malte' },
  { code: 'MA', name: 'Maroc' },
  { code: 'MU', name: 'Maurice' },
  { code: 'MR', name: 'Mauritanie' },
  { code: 'MX', name: 'Mexique' },
  { code: 'FM', name: 'Micronésie' },
  { code: 'MD', name: 'Moldavie' },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolie' },
  { code: 'ME', name: 'Monténégro' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'NA', name: 'Namibie' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Népal' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norvège' },
  { code: 'NZ', name: 'Nouvelle-Zélande' },
  { code: 'OM', name: 'Oman' },
  { code: 'UG', name: 'Ouganda' },
  { code: 'UZ', name: 'Ouzbékistan' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PW', name: 'Palaos' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papouasie-Nouvelle-Guinée' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'NL', name: 'Pays-Bas' },
  { code: 'PE', name: 'Pérou' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Pologne' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Roumanie' },
  { code: 'GB', name: 'Royaume-Uni' },
  { code: 'RU', name: 'Russie' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'KN', name: 'Saint-Kitts-et-Nevis' },
  { code: 'LC', name: 'Sainte-Lucie' },
  { code: 'VC', name: 'Saint-Vincent-et-les-Grenadines' },
  { code: 'SB', name: 'Salomon' },
  { code: 'SV', name: 'Salvador' },
  { code: 'WS', name: 'Samoa' },
  { code: 'ST', name: 'Sao Tomé-et-Principe' },
  { code: 'SN', name: 'Sénégal' },
  { code: 'RS', name: 'Serbie' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapour' },
  { code: 'SK', name: 'Slovaquie' },
  { code: 'SI', name: 'Slovénie' },
  { code: 'SO', name: 'Somalie' },
  { code: 'SD', name: 'Soudan' },
  { code: 'SS', name: 'Soudan du Sud' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Suède' },
  { code: 'CH', name: 'Suisse' },
  { code: 'SR', name: 'Suriname' },
  { code: 'SY', name: 'Syrie' },
  { code: 'TJ', name: 'Tadjikistan' },
  { code: 'TZ', name: 'Tanzanie' },
  { code: 'TD', name: 'Tchad' },
  { code: 'CZ', name: 'Tchéquie' },
  { code: 'TH', name: 'Thaïlande' },
  { code: 'TL', name: 'Timor oriental' },
  { code: 'TG', name: 'Togo' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinité-et-Tobago' },
  { code: 'TN', name: 'Tunisie' },
  { code: 'TM', name: 'Turkménistan' },
  { code: 'TR', name: 'Turquie' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Viêt Nam' },
  { code: 'YE', name: 'Yémen' },
  { code: 'ZM', name: 'Zambie' },
  { code: 'ZW', name: 'Zimbabwe' },
];

export default function Register() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    country: 'BF',
  });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('Le nom et le prénom sont requis');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (formData.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await api.register(
        formData.email,
        formData.phone,
        formData.password,
        formData.country,
        formData.firstName,
        formData.lastName
      );

      navigate('/login', { state: { message: 'Compte créé avec succès. Vérifiez votre email.' } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'inscription");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-8">Créer un compte</h1>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Prénom
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Jean"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Nom
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Dupont"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                type="email"
                className="input"
                placeholder="email@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Téléphone
              </label>
              <input
                type="tel"
                className="input"
                placeholder="+226 70 00 00 00"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Pays
              </label>
              <select
                className="input"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Min. 8 caractères"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Répétez le mot de passe"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
              />
            </div>

            <div className="flex items-start gap-2">
              <input type="checkbox" id="terms" required className="mt-1" />
              <label htmlFor="terms" className="text-sm text-slate-400">
                J'accepte les{' '}
                <a href="/terms" className="link">conditions d'utilisation</a>
                {' '}et la{' '}
                <a href="/privacy" className="link">politique de confidentialité</a>
              </label>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              loadingText="Création..."
            >
              Créer mon compte
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            Déjà un compte ?{' '}
            <Link to="/login" className="link">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
