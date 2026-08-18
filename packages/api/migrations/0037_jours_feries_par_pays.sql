-- Le calendrier ouvre appartient a un pays — ADR 017, constat AH.
--
-- `settlementDate(requestedAt, businessDays, holidays = [])` accepte une liste de
-- jours feries depuis l'origine, et `business-days.ts` explique pourquoi elle
-- n'est pas codee en dur : ils different selon la juridiction et changent chaque
-- annee, donc « une liste fausse produirait silencieusement de mauvaises dates
-- de reglement ».
--
-- L'unique appelant ne passait rien, et aucune liste n'existait nulle part. Le
-- T+3 d'une sortie de location pouvait donc echoir un jour ou la contrepartie
-- qui doit rendre l'or est fermee.
--
-- La plateforme n'etant pas dediee a un pays, la liste appartient au pays et non
-- au code. Elle reste VIDE par defaut : fournir les jours feries d'une
-- juridiction est un acte d'exploitation, pas une constante. Ce qui change, c'est
-- qu'il existe enfin un endroit ou les mettre.

ALTER TABLE country_config ADD COLUMN business_holidays TEXT NOT NULL DEFAULT '[]';
