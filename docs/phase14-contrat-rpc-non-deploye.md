# KM16 Phase 14 — contrat des fonctions serveur (NON DÉPLOYÉ)

## Portée
Les fonctions ci-dessous sont une **spécification**, pas une implémentation opérationnelle. Elles ne concernent que les fiches exclusivement importées, identifiées par `(season_id, source='import', external_id)`. Les fiches KM16 issues de commandes restent exclues jusqu'à obtention d'une clé personnelle stable.

## Lecture : `km16_member_review_list(p_season, p_environment)`
- Authentifier et autoriser l'administrateur **sur le serveur** à chaque appel, sans faire confiance à l'adresse e-mail affichée par le navigateur.
- Vérifier `p_environment in ('live','test')` et le format de saison autorisé.
- Retourner seulement les fiches importées actives de cette saison, et leurs statuts enregistrés; sans statut, afficher `a_verifier` (valeur implicite, sans insertion).
- Retourner `source_member_id`, `state`, `version`, `updated_at`, `updated_by`; ne pas retourner d'e-mails, coordonnées ou paiements.

## Écriture : `km16_member_review_set(p_season, p_environment, p_external_id, p_state, p_expected_version)`
- Vérifier identité de session et rôle d'administrateur côté serveur; rejeter un utilisateur non autorisé.
- Valider strictement saison, environnement, identifiant non vide et état dans `a_verifier`, `en_cours`, `controle`.
- Dans une **transaction unique**, verrouiller la fiche importée correspondante et vérifier `archived_at is null`. Une fiche archivée ne doit jamais recevoir un nouveau statut.
- Verrouiller le statut existant et comparer sa `version` à `p_expected_version`; en cas de conflit, refuser avec une erreur explicite et demander un rafraîchissement. Pour un premier enregistrement, version attendue = 0.
- En cas de changement réel, enregistrer le nouvel état et incrémenter la version; insérer un événement d'historique avec ancien/nouvel état, auteur et horodatage dans la **même transaction**.
- Si l'état est inchangé, ne pas produire un événement d'historique artificiel.
- Ne jamais modifier `km16_external_clients`, les tables d'adhésions, les paiements ou les rapprochements.
- Retourner le statut effectivement enregistré, sa version et sa date **après succès**. Ne pas annoncer une sauvegarde avant la réponse serveur.

## Historique : `km16_member_review_history_list(p_season, p_environment, p_external_id)`
- Même contrôle d'autorisation côté serveur.
- Résultats paginés et ordonnés par date et identifiant, lecture seule.
- Aucun accès direct aux tables pour les rôles `anon` ou `authenticated`; RLS activée et revue des droits `EXECUTE` des fonctions. Si une fonction privilégiée est nécessaire, isoler ses droits et sécuriser son `search_path`.

## Conditions de validation
1. Exécuter ces fonctions dans un projet de test isolé; ne pas utiliser des fiches réelles comme données d'essai.
2. Vérifier accès refusé sans connexion et avec compte non administrateur.
3. Vérifier la séparation des saisons, `test` et `live`, et l'impossibilité de modifier une fiche archivée.
4. Tester deux modifications concurrentes, la cohérence version/historique et le retour d'erreur réseau.
5. Vérifier que la fonction de lecture n'expose aucune information personnelle ou financière supplémentaire.
6. Vérifier les avis de sécurité Supabase et les permissions réelles avant déploiement.
7. Déployer le backend séparément de l'interface et conserver la phase 13 comme solution de repli.

**Statut : spécification uniquement. Aucune fonction SQL, migration ou interface de production déployée.**
