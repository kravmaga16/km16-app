# KM16 — Audit des fonctions privilégiées exposées aux rôles clients

Contrôle en lecture seule du 16 novembre 2026 sur le projet Supabase `tlfewpbgbwesdriklxzb`.

Les cinq fonctions `SECURITY DEFINER` signalées comme exécutables par `anon` ont été examinées dans le catalogue PostgreSQL. **Toutes les cinq sont des fonctions de déclencheur** (retour `trigger`) effectivement associées à un déclencheur :

| Fonction | Déclencheur | Table |
| --- | --- | --- |
| `km16_enqueue_membership_purchase` | `km16_purchase_mail_membership` | `km16_membership_payments` |
| `km16_enqueue_shirt_purchase` | `km16_purchase_mail_shirt` | `km16_shirt_orders` |
| `km16_enqueue_video_purchase` | `km16_purchase_mail_video` | `km16_purchases` |
| `km16_publish_scheduled_campaign_news` | `km16_campaign_to_news` | `km16_scheduled_campaigns` |
| `km16_validate_external_booking_link` | `validate_external_booking_link` | `km16_booking_external_links` |

Les fonctions de déclencheur ne sont normalement pas invoquées directement comme RPC ; leur privilège `EXECUTE` public reste toutefois une surface de permission à examiner. Cette constatation ne prouve pas une exploitation possible.

## Mesure proposée, non appliquée

Examiner dans une migration séparée la révocation de `EXECUTE` à `PUBLIC`, `anon` et `authenticated` pour ces cinq signatures sans argument, après confirmation des dépendances et des propriétaires. Tester les cinq parcours métier (adhésions, tee-shirts, vidéos, campagnes, liens de réservation) en environnement isolé avant déploiement. Ne pas désactiver les déclencheurs et ne pas modifier les transactions.

## Suivi permanent des fiches

La création des tables et RPC `km16_member_review_*` reste bloquée jusqu'à vérification de la sauvegarde/restauration et de l'autorisation serveur. Les 161 fiches importées ne sont pas modifiées par cet audit.
