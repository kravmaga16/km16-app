# KM16 — Phase 14 : suivi permanent des contrôles adhérents (conception)

## Objectif
Conserver un suivi de vérification distinct des données sources des adhérents, synchronisé entre les appareils de l'administrateur, sans fusion automatique ni modification de paiement.

## Préconditions à vérifier avant déploiement
1. Identifier de façon stable les fiches provenant de Fighty, Sportigo et des achats KM16 : **ne jamais** utiliser uniquement nom, prénom ou e-mail comme identifiant.
2. Garantir la séparation des saisons et des environnements TEST/production.
3. Vérifier que la liste des fiches clients renvoie un identifiant stable et non réattribuable. Si une source ne le garantit pas, désactiver le suivi permanent pour ces fiches jusqu'à résolution.
4. Définir l'autorisation administrateur côté serveur, indépendante de l'interface. Vérifier les rôles et politiques existants avant toute création de table ou fonction.
5. Vérifier les migrations, sauvegardes, restauration et règles de conservation des journaux.

## Modèle proposé (non déployé)
- Table dédiée `km16_member_review_status` : clé composite (season_id, environment, source_key, source_member_id), état (`a_verifier`, `en_cours`, `controle`), date de mise à jour, identifiant de l'administrateur, version pour conflits.
- Table dédiée `km16_member_review_history` : identifiant de l'événement, clé du dossier, état précédent/nouveau, date, administrateur.
- Les tables ne stockent ni montants, ni transactions, ni coordonnées personnelles. La clé source doit être stable.
- Accès via des fonctions serveur administrateur autorisées et vérifiées; RLS activée et aucun accès public. Historique append-only, validation stricte des états, transactions atomiques et gestion des conflits de mises à jour.
- Les statuts de suivi ne sont **pas** une validation administrative d'adhésion.

## Interface proposée
- Liste : « À vérifier », « En cours », « Contrôlé » ; dernière modification et historique consultable.
- Chargement des statuts après authentification, avec état explicite « Indisponible » si la synchronisation échoue.
- Aucune écriture silencieuse; confirmation visible uniquement après succès serveur.
- Conserver le suivi temporaire actuel jusqu'à la validation du stockage permanent.

## Tests et mise en service
1. Tester les identifiants et la séparation des saisons / modes TEST et production.
2. Vérifier les autorisations côté serveur (non connecté, adhérent ordinaire, administrateur).
3. Vérifier l'historique, les conflits, les erreurs réseau, l'absence de modifications des fiches et des paiements.
4. Exécuter les tests Chromium/WebKit et valider la connexion réelle dans Safari.
5. Déployer la base et l'interface dans des étapes distinctes avec plan de retour arrière.

**État : conception uniquement. Aucune migration, aucune table et aucune fonction de production modifiées.**

## Vérification technique du 16 novembre 2026
- La table `km16_external_clients` possède une clé `external_id` et un `season_id`. L'identifiant affiché côté console utilise le préfixe `import:` pour certaines fiches; la correspondance doit être testée avant toute écriture.
- La fonction `km16_client_rows` renvoie des identifiants UUID de commandes d'adhésion : un identifiant de commande n'est pas nécessairement un identifiant de personne. Ne pas utiliser cette valeur seule pour suivre une personne sur plusieurs achats.
- Le projet possède déjà un suivi administratif partagé (`km16_admin_action_progress` et ses RPC). Celui-ci porte sur des catégories d'actions, **pas** sur des fiches individuelles; il ne doit pas être détourné pour ce nouveau besoin.
- Le modèle permanent doit traiter explicitement le cas d'un adhérent apparaissant plusieurs fois et le cas de fiches d'origine différente portant la même identité.
- **Décision de sécurité :** aucun déploiement de table ou RPC tant que la stratégie de clés stables pour les fiches non importées n'est pas vérifiée et testée.

## Vérification complémentaire de la fonction Edge `km16-clients`
La version 22 de la fonction a été inspectée en lecture seule.

- Les fiches importées non rapprochées sont émises avec `id = 'import:' + external_id`. Cette valeur est associée à `season_id` dans la table d'import.
- Les fiches d'adhésion sont regroupées par `[user_id, nom normalisé, prénom normalisé, date de naissance]`, puis l'interface reçoit `id = entries[0].id` : il s'agit de l'UUID de la **première commande du groupe**, et non d'un identifiant personnel immuable. Le suivi permanent ne doit pas prendre cet UUID pour un identifiant stable d'adhérent sans garantie supplémentaire.
- La fonction peut enrichir une fiche d'adhésion avec des données d'une fiche importée en cas de correspondance unique. Cela ne constitue pas une clé persistante sûre pour le suivi administratif. **Ne pas modifier cette logique de rapprochement dans cette phase.**

### Décision d'implémentation
1. Pour les fiches exclusivement importées, envisager une clé `(season_id, environment, source='import', external_id)`, sous réserve d'un contrôle de non-réutilisation des `external_id` et des règles d'archivage.
2. Pour les fiches issues des adhésions, **bloquer les écritures permanentes** tant qu'une clé personnelle immuable n'a pas été conçue et exposée par le serveur. Ne pas utiliser le premier numéro de commande comme identifiant personnel.
3. Le suivi temporaire de la phase 13 demeure disponible pour toutes les fiches jusqu'à la mise en service contrôlée du suivi permanent.
4. Le statut et l'historique permanents seront stockés séparément, avec contrôle d'accès serveur et journalisation atomique. Ne pas ajouter de colonnes aux tables de paiements ou d'adhérents.

## Préparation du schéma SQL (non déployé)
- Le contrôle en lecture seule du 16 novembre indique **161 fiches importées**, **161 couples (season_id, external_id) distincts**, et **aucun identifiant vide**.
- L'index primaire de `km16_external_clients` est bien composé de `(external_id, season_id)`.
- Un brouillon SQL a été ajouté : `docs/phase14-schema-propose-non-deploye.sql`. Il limite le suivi permanent à `source='import'`, prévoit deux tables distinctes pour le statut et l'historique, active la RLS sans accorder d'accès direct et ne crée aucune RPC.
- Ce fichier **n'est pas une migration appliquée**. Il nécessite une validation sur environnement de test, une revue des droits serveur et une procédure de retour arrière avant tout déploiement.

## Revue de pré-déploiement supplémentaire
- Contrôle en lecture seule : 161 fiches importées en base, dont **160 actives sur la saison 2026/2027** et **1 archivée**. Le suivi permanent ne devra pas proposer une fiche archivée comme dossier actif.
- Le brouillon a été corrigé pour ne pas ajouter de clé étrangère bloquant l'archivage ou la suppression d'une fiche importée. L'existence et l'état actif de la fiche devront être vérifiés **dans la transaction serveur** avant tout changement de statut.
- Un contrôle statique `scripts/check-member-review-schema.mjs` vérifie la RLS, la séparation des clés et l'absence d'accès direct public dans le brouillon. Il ne remplace pas des tests SQL et de sécurité sur un projet de développement.
- Les changements restent dans la PR de conception, sans création de table ni RPC de production.
