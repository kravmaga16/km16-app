# Déploiement de KM16

## Site GitHub Pages

Le dépôt `kravmaga16/km16-app` contient le site statique servi sur `app.km16.fr`. La publication ordinaire se fait depuis `main`. Vérifier le résultat de la publication GitHub Pages et le domaine `app.km16.fr` après chaque mise en ligne.

Depuis un clone, à la racine du dépôt :

```bash
git fetch origin main
bash scripts/package-pages.sh /tmp/km16-pages.tar origin/main
sha256sum /tmp/km16-pages.tar
```

La commande affiche le SHA Git et produit un paquet reproductible pour ce commit. Seuls les fichiers publics sont exportés. La CI produit aussi ce paquet après ses vérifications. Pour publier un correctif, intégrer le commit testé dans `main`. Pour revenir à une version précédente, annuler le commit de publication avec `git revert` et contrôler le nouveau déploiement. Les migrations déjà appliquées se traitent séparément.

Contrôles après publication : accueil, planning, page Clients, connexion administrateur et chargement du fichier clients. Tester un règlement fictif uniquement dans l’environnement « TEST ». Contrôler la fiche du pratiquant, le récapitulatif et l’export Excel pour la même saison.

## Supabase

Le site utilise le projet `tlfewpbgbwesdriklxzb`. Le dépôt du site seul ne permet pas encore de reconstruire un projet Supabase vierge. Au 19 novembre 2026, l’historique en ligne contient 66 migrations et le dépôt en contient 14. Le projet exécute aussi 19 fonctions Edge actives. Les sources présentes dans `server/` et `supabase/functions/` ne constituent pas un inventaire exhaustif des versions actives.

Avant d’appliquer une évolution SQL ou de republier une fonction :

1. Comparer les migrations du dépôt à l’historique distant avec `supabase migration list --linked`. Vérifier les dépendances de la migration visée.
2. Examiner la version déployée de la fonction concernée et conserver ses paramètres de déploiement, notamment `verify_jwt`. Vérifier les secrets nécessaires dans le tableau de bord sans enregistrer leurs valeurs dans Git.
3. Tester sur un projet de préproduction ou avec des données fictives. Appliquer uniquement la migration ou la fonction vérifiée à la production, puis contrôler son résultat. Un `db push` global avant réconciliation de l’historique risquerait d’appliquer des changements incompatibles.

La migration `20261119142144_km16_club_registration_links.sql` correspond à la version enregistrée en production. Elle requiert notamment `public.km16_ops_is_admin()`.

L’avis Auth `auth_leaked_password_protection` signale la protection désactivée le 19 novembre 2026. Le réglage se trouve dans **Authentication → Sign In / Providers → Email**. La protection des mots de passe compromis exige un forfait Supabase Pro ou supérieur. Après activation, relancer Security Advisor pour confirmer la disparition de l’avis.
