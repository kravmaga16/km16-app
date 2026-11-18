# KM16 — Relances d'e-mails : spécification de préproduction

Statut : préparation uniquement. Aucun déploiement, aucune modification de la branche main, aucun envoi.

## Périmètre
Console `clients.html` : futur onglet « Relances d'e-mails », visible uniquement après contrôle serveur d'autorisation administrateur. Ne pas placer de données personnelles dans un fichier public GitHub Pages.

Sources existantes :
- `public.km16_admin_purchase_notifications` (achats), clé `id`, référence `event_key`, destinataire `recipient`
- `public.km16_scheduled_mail_deliveries` (campagnes), clé `id`, référence `campaign_id`, destinataire `email`

## Règles
- `failed` : signaler « Validation administrative requise ». Aucune relance automatique.
- `sending` avec `attempted_at < now() - interval '15 minutes'` : signaler « Blocage à vérifier ». Aucun renvoi automatique.
- `uncertain` : signaler « Vérification manuelle obligatoire ». Aucune relance avant vérification de la livraison auprès du fournisseur.
- `pending`, `accepted` et `sending` plus récents : exclus.
- Une tentative `sending` sans `attempted_at` doit être remontée séparément comme anomalie de données lors d'une évolution future.

## Sécurité
- Ne jamais exposer `service_role` dans le navigateur ou GitHub Pages.
- La fonction SQL de lecture `SECURITY INVOKER` exige des droits SELECT sur les tables ; EXECUTE seul ne suffit pas.
- Utiliser un endpoint serveur authentifié vérifiant l'identité et les droits administrateur, avec un rôle serveur restreint ; ne pas exposer directement la fonction aux utilisateurs connectés.
- Aucun bouton d'envoi dans cette phase ; aucune mise à jour des états.
- Tracer séparément les décisions administratives dans une évolution ultérieure, avec protection anti-doublon et validation explicite.

## Critères d'acceptation
1. Affichage des trois catégories, filtres et compteurs, sans action d'envoi.
2. Aucune donnée visible pour un visiteur non autorisé.
3. Aucun secret serveur dans HTML ou JavaScript client.
4. Tests locaux : 14 cas, 6 alertes, 8 exclusions, aucune donnée conservée après ROLLBACK (résultat transmis par l'utilisateur le 18/11/2026).
5. Vérification du vrai schéma et de la chaîne d'authentification avant toute intégration.
6. Revue de code et validation explicite avant fusion vers main.
