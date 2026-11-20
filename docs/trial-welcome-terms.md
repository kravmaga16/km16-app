# Conditions du cours d’essai — version du 20 novembre 2026

Le choix du mail de bienvenue nº 1 autorise le pratiquant à choisir librement une séance adaptée dans le planning publié après l’enregistrement de sa demande. La page du cours d’essai, les guides publics, le catalogue et les indications du formulaire suivent cette règle. Le récapitulatif d’un essai déjà effectué ne propose pas de recommencer un essai.

## Nouvelle version, archives conservées

La version `km16-2026-11-20-v6` change uniquement le paragraphe relatif au cours d’essai offert et les mentions de version/date des conditions. Les modalités des offres payantes sont inchangées.

La migration crée une nouvelle archive avec le contenu exact de `conditions-adhesion.html` et reprend la politique de confidentialité et le règlement intérieur de l’archive V5. Elle conserve l’intégralité de l’archive `km16-2026-11-10-v5`, ainsi que les versions et instantanés de toutes les commandes déjà enregistrées.

La migration exige la configuration V5, l’empreinte du texte V5 vérifié et les deux produits d’essai gratuits attendus. Si ces conditions ne sont plus réunies, aucune partie du changement n’est appliquée. Elle met les notes des deux produits à jour et retire leur vérification d’éligibilité spécifique (`review=false`). Les paramètres et prix des autres offres ne changent pas.

## Reprise des paiements déjà commencés

Une commande payante ayant accepté V5 peut encore rouvrir une session Stripe expirée lorsque la configuration passe précisément à V6. Cette exception est limitée à ce couple de versions et exclut les produits `essai` et `essai-saint-jean`. Le contrôle des montants, de la disponibilité, de la saison, du propriétaire et des paiements reste inchangé. Toute autre différence de version continue de bloquer la reprise.

L’ancienne version acceptée reste attachée à la commande et au contrat. La compatibilité ne réécrit ni le consentement ni les pièces contractuelles historiques.

## Vérification

- `tests/trial-welcome-terms.test.mjs` exécute réellement la migration dans PostgreSQL en mémoire : conservation des archives et contrats, correspondance exacte de V6 avec la page, produits payants inchangés et refus atomique en cas de précondition invalide.
- `tests/checkout-reminder-creators.test.mjs` couvre la reprise V5→V6 dans les deux sources de la fonction adhésions, et le refus des autres versions et des identifiants d’essai.
- Le scénario navigateur `reminder-free` vérifie la confirmation de la demande, l’indication du libre choix de séance et le lien vers le planning.
