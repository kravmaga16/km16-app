# KM16 — Phase 15 : pré-déploiement du suivi permanent

Date : 16 novembre 2026. **Aucune migration exécutée par ce document.**

## Projet cible vérifié

- Projet Supabase `tlfewpbgbwesdriklxzb` (nom d'affichage KM16-Videos) : la console `clients.mjs` et la fonction `km16-clients` utilisent ce projet.
- `public.km16_external_clients` existe, avec `external_id text`, `season_id text`, `archived_at timestamptz`.
- 161 fiches importées, 160 non archivées, 161 couples `(season_id, external_id)` distincts.
- `km16_member_review_status` et `km16_member_review_history` absentes au contrôle.
- Les fonctions `km16_member_review_*` sont absentes au contrôle.

## Garde-fous avant une migration de production

1. Obtenir un point de restauration ou une sauvegarde vérifiée et une procédure de retour arrière testée. Ne pas supprimer l'historique après activation.
2. Réexaminer les privilèges `SECURITY DEFINER`, les droits `EXECUTE`, la propriété des fonctions et leur `search_path` sur le projet réel.
3. Vérifier la stratégie d'autorisation administrateur sans dépendre seulement d'un e-mail : idéalement rôle serveur ou identité immuable contrôlée, et tester refus anonyme et utilisateur non administrateur.
4. Déployer le schéma et les RPC en transaction avec révocations immédiates, puis vérifier RLS, ACL et absence de lecture directe par `anon` / `authenticated`.
5. Exécuter des essais d'écriture avec **des données fictives** dans un projet isolé; vérifier conflits de version, historique, archivage, saisons et environnements.
6. Activer d'abord la lecture et l'interface derrière un indicateur désactivé par défaut; ne rendre l'écriture disponible qu'après tests réels d'authentification.
7. Ne jamais utiliser un identifiant de commande comme clé personnelle stable; restreindre l'écriture aux fiches exclusivement importées.
8. Ne pas toucher aux transactions Stripe, Fighty, Sportigo, réservations ni aux tables sources.

## Avis de sécurité constatés

Supabase signale 42 tables RLS sans politique (à analyser selon le modèle d'accès), 5 fonctions privilégiées exécutables par `anon`, 26 par `authenticated`, et un avertissement sur la protection des mots de passe compromis. Ces alertes ne suffisent pas à elles seules à conclure à une faille.

## Statut

**Pré-déploiement uniquement.** Les tests GitHub Actions de la PR 16 ont réussi en environnement isolé. Aucun test ne prouve encore la sécurité effective des nouvelles RPC dans la base de production. Ne pas activer le suivi permanent avant les contrôles ci-dessus.
