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
