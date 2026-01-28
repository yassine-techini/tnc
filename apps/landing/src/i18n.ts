export const translations = {
  fr: {
    header: {
      tagline: "Tokenisation d'Or Souveraine",
      countries: 'Pays',
      about: 'A propos',
      contact: 'Contact',
    },
    hero: {
      badge: 'Plateforme active au Burkina Faso',
      title1: "L'or africain,",
      title2: 'tokenise pour tous',
      description:
        "TNC Trading permet aux citoyens africains d'investir dans l'or national via des tokens numeriques. 1 token = 1 gramme d'or physique stocke par l'Etat.",
      ctaPrimary: 'Acceder a TNC Burkina Faso',
      ctaSecondary: 'Voir tous les pays',
    },
    stats: {
      activeCountries: 'Pays actif',
      comingCountries: 'Pays a venir',
      guaranteed: 'Garanti par l\'or',
      purity: 'Or pur 999.9',
    },
    countries: {
      title: 'Choisissez votre pays',
      description:
        "TNC Trading s'etend progressivement dans toute l'Afrique de l'Ouest. Selectionnez votre pays pour acceder a la plateforme.",
      available: 'Disponible',
      comingSoon: 'Bientot disponible',
    },
    about: {
      title: 'A propos de TNC Trading',
      description:
        "TNC Trading est une initiative panafricaine visant a democratiser l'acces a l'or pour tous les citoyens. En partenariat avec les gouvernements, nous permettons d'investir dans l'or national de maniere securisee, transparente et accessible.",
      secure: {
        title: 'Securise',
        description:
          "Or physique stocke par l'Etat, verification KYC stricte, transactions cryptees.",
      },
      transparent: {
        title: 'Transparent',
        description:
          'Preuve de reserve publique, prix LBMA en temps reel, audits reguliers.',
      },
      accessible: {
        title: 'Accessible',
        description:
          "Paiement mobile money, achat des 1g d'or, interface simple et intuitive.",
      },
    },
    contact: {
      title: 'Contactez-nous',
      description:
        'Vous etes un gouvernement interesse par le deploiement de TNC Trading dans votre pays?',
    },
    footer: {
      copyright: "2025 TNC Trading. Tokenisation d'or souveraine en Afrique.",
    },
  },
  en: {
    header: {
      tagline: 'Sovereign Gold Tokenization',
      countries: 'Countries',
      about: 'About',
      contact: 'Contact',
    },
    hero: {
      badge: 'Platform active in Burkina Faso',
      title1: 'African gold,',
      title2: 'tokenized for all',
      description:
        'TNC Trading enables African citizens to invest in national gold through digital tokens. 1 token = 1 gram of physical gold stored by the State.',
      ctaPrimary: 'Access TNC Burkina Faso',
      ctaSecondary: 'See all countries',
    },
    stats: {
      activeCountries: 'Active country',
      comingCountries: 'Coming soon',
      guaranteed: 'Gold backed',
      purity: 'Pure gold 999.9',
    },
    countries: {
      title: 'Choose your country',
      description:
        'TNC Trading is progressively expanding across West Africa. Select your country to access the platform.',
      available: 'Available',
      comingSoon: 'Coming soon',
    },
    about: {
      title: 'About TNC Trading',
      description:
        'TNC Trading is a pan-African initiative aimed at democratizing access to gold for all citizens. In partnership with governments, we enable secure, transparent, and accessible investment in national gold.',
      secure: {
        title: 'Secure',
        description:
          'Physical gold stored by the State, strict KYC verification, encrypted transactions.',
      },
      transparent: {
        title: 'Transparent',
        description:
          'Public proof of reserve, real-time LBMA prices, regular audits.',
      },
      accessible: {
        title: 'Accessible',
        description:
          'Mobile money payment, buy from 1g of gold, simple and intuitive interface.',
      },
    },
    contact: {
      title: 'Contact us',
      description:
        'Are you a government interested in deploying TNC Trading in your country?',
    },
    footer: {
      copyright: '2025 TNC Trading. Sovereign gold tokenization in Africa.',
    },
  },
};

export type Language = keyof typeof translations;
export type Translations = typeof translations.fr;
