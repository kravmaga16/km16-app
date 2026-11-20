# Notifications administratives des achats KM16

Les nouveaux achats confirmés utilisent la file `km16_admin_purchase_notifications`.
Le worker existant `km16-admin-mail-worker` envoie les notifications à
`contact@km16.fr`. Cette modification conserve ce service d’envoi et sa protection
contre les doublons par `event_key`.

## Couverture

| Achat | Création de la notification |
| --- | --- |
| Abonnement annuel ou mensuel | Chaque paiement réel positif confirmé ; une alerte par échéance |
| Stage | Même circuit de paiement, libellé « stage » |
| Cours à l’unité payant | Même circuit de paiement, libellé « cours à l’unité » |
| Vidéo | Déclencheur vidéo existant, conservé |
| Tee-shirt | Déclencheur existant après confirmation Stripe ; nouveau contrôle serveur chaque minute |
| Chèque ou espèces saisis au club | Nouveau déclencheur à l’insertion du règlement réel |

Les essais gratuits, les commandes de test et les imports historiques ne sont pas
repris. Un changement de libellé ne recrée pas les notifications déjà enregistrées.
Un règlement au club indique son mode, son montant et sa saison ; il ne prétend pas
identifier un produit que le formulaire ne renseigne pas.

## Tee-shirts : fonctionnement serveur

La nouvelle fonction `km16-reconcile-shirt-payments` utilise le même jeton privé
d’automatisation et le même interrupteur `km16_automation_settings.enabled` que le
worker d’envoi. Elle accepte uniquement POST avec `x-km16-automation` valide.

Toutes les minutes, `km16_dispatch_shirt_payment_checks()` demande une exécution.
La fonction réserve jusqu’à huit commandes réelles encore en attente, avec au plus
quatre vérifications simultanées. `FOR UPDATE SKIP LOCKED` et la date de tentative
empêchent la reprise immédiate du même lot ; les commandes jamais vérifiées puis
les tentatives les plus anciennes sont prioritaires.

Le serveur lit uniquement Stripe. Il vérifie la session, le mode réel, les
identifiants de commande, le montant, la devise, le paiement et sa transaction.
Une réponse incomplète, un remboursement ou un litige ne confirme pas un achat.
Une session expirée non payée annule la commande en attente. Les incidents réseau
laissent la commande disponible pour une prochaine vérification.

La mise à jour compare encore `pending`, le mode et la session avant de passer à
`paid` : une consultation simultanée de l’écran ne produit pas de second e-mail.
Le service de vérification n’envoie aucun e-mail lui-même. Le worker existant prend
ensuite la notification, généralement au passage suivant. La fréquence d’une
minute n’est pas une garantie de réception en exactement soixante secondes.

## Déploiement reproductible

Sources complètes de la nouvelle Edge Function :

- `supabase/functions/km16-reconcile-shirt-payments/index.ts`
- `supabase/functions/km16-reconcile-shirt-payments/handler.mjs`

Ordre d’application :

1. Migration se terminant par `_purchase_notification_coverage.sql`.
2. Déploiement de la nouvelle fonction, avec vérification JWT de la passerelle
   désactivée ; le handler vérifie lui-même le jeton privé d’automatisation.
3. Migration se terminant par `_schedule_shirt_payment_reconciliation.sql`.

Commande vérifiée avec Supabase CLI 3.2.0, après authentification du mainteneur :

```bash
supabase functions deploy km16-reconcile-shirt-payments \
  --remote=tlfewpbgbwesdriklxzb --use-api --no-verify-jwt
```

La fonction réutilise les secrets existants `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` et `KM16_SHIRTS_STRIPE_LIVE_SECRET_KEY`.
Aucune valeur secrète n’est stockée dans le dépôt. Le nouveau service n’a pas
besoin de mot de passe SMTP.

Les versions des fichiers de migration doivent correspondre aux versions réellement
enregistrées dans `supabase_migrations.schema_migrations` après leur application.
La migration de planification ne doit être appliquée qu’une fois la fonction prête.

## Vérification

Le workflow `KM16 purchase notifications` exécute le handler avec des réponses
Stripe simulées puis les tests SQL sur un PostgreSQL 17 isolé. Il n’utilise aucun
secret de production et ne fait partir aucun e-mail.

```bash
node --test tests/shirt-payment-reconciliation.test.mjs
```

Les tests SQL utilisent `purchase-notifications-fixture.sql`, la migration métier,
puis `purchase-notifications-postgres.sql`. Le runner
`purchase-notifications-sql.test.mjs` permet aussi l’exécution locale avec une
installation externe de PGlite 0.5.16 indiquée par `PGLITE_MODULE`.

Après mise en service, vérifier l’activation et le propriétaire du job cron, une
réponse HTTP 200 de la nouvelle fonction, les droits de la RPC et l’état de la file
de notifications. Une réussite du job SQL indique la programmation de la requête
HTTP, pas l’acceptation d’un e-mail par SMTP.

L’état `accepted` de la file correspond à l’acceptation du message par SMTP.
Il ne prouve pas sa présence dans le dossier de réception. Les envois `uncertain`
ne sont pas remis automatiquement en attente, pour éviter des doublons.

## Arrêt ciblé

Pour suspendre uniquement la vérification automatique des tee-shirts, désactiver
le job `km16-shirt-payments-every-minute`. Le paiement, la consultation des commandes
et le worker d’envoi existants restent disponibles. L’interrupteur global
d’automatisation arrête également cette nouvelle vérification.
