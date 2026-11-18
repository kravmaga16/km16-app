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

## Vérification du 18/11/2026
- Schéma distant `KM16-Videos` inspecté en lecture seule : les colonnes nécessaires existent dans les deux tables.
- Aucun contenu de notification ni donnée personnelle n'a été extrait pendant ce contrôle.
- Les tests GitHub Actions « KM16 email alert safety checks » et « Phase 14 PostgreSQL isolé » sont passés ; la suite JavaScript générale doit encore être validée.
- Déploiement toujours bloqué tant que l'autorisation administrative centralisée, les tests HTTP/CORS et les tests navigateur ne sont pas validés.
- La fonction est un prototype : aucune relance automatique et aucun statut modifié.

## État des vérifications CI — 18 novembre 2026
Sur le commit `fb72fa2bb330c19f7fc7bb7846fb73e04e2d5704`, les workflows GitHub suivants ont terminé avec succès :
- `KM16 email alert safety checks` — run 44289675942 ;
- `KM16 - Phase 14 PostgreSQL isolé` — run 44289675926 ;
- `KM16 - Verification JavaScript` — run 44289675877 (incluant les tests navigateurs existants).
Ces succès valident le contrat statique et les tests existants, **pas** l'autorisation de bout en bout de la nouvelle Edge Function, non déployée. Les tests HTTP avec identité autorisée/interdite et les scénarios de pagination doivent encore être exécutés en environnement isolé.
