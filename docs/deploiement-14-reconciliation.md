# KM16 — Déploiement 14 : contrôle de réconciliation

Date : 2026-11-16

## Périmètre

Réconciliation de la branche historique `develop/admin-ui-safe-20261116` avec `main`, sans changement des données adhérents ni de Supabase.

## Vérifications du code

- `scripts/check-admin-browser.mjs` : contenu identique entre les deux branches examinées.
- `clients.html` : la version `main` comporte les styles de navigation ainsi que les améliorations ultérieures des profils adhérents et du tableau de bord.
- `scripts/check-admin-mobile.mjs` : la version `main` ajoute des contrôles pour les profils, les dossiers et les actions rapides.
- `.github/workflows/km16-javascript-check.yml` : la version `main` conserve les tests navigateur et ajoute les tests de qualité des dossiers, des compteurs, des finances, du rendu et de l'actualisation.

## Règles de livraison

- Ne pas remplacer `main` par les versions plus anciennes des fichiers.
- Ne pas modifier les données de production ni les paramètres de paiement.
- Vérifier les résultats des contrôles GitHub Actions de la pull request avant toute décision de fusion.
- Les contrôles HTML/CSS sans authentification ne valent pas validation du parcours administrateur réel ni de Supabase.

Cette note de traçabilité n'introduit aucun changement fonctionnel.
