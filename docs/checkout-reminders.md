# Rappels de paiement KM16

## Comportement client

Un rappel facultatif est proposé pour les nouvelles démarches de paiement réelles : adhésions et offres payantes du catalogue (y compris stages et séances payantes), tee-shirts et vidéos. Les essais gratuits, les paiements de test et les échéances ultérieures d'un abonnement déjà commencé sont exclus.

La case est distincte des CGV et décochée initialement :

> Je souhaite recevoir un seul rappel par e-mail si je ne termine pas ce paiement.

Seul le booléen `true` transmis après un choix explicite est accepté. L'adresse destinataire vient du compte Supabase confirmé côté serveur. Un changement de compte, de pratiquant ou de sélection efface le choix. Un brouillon OTP n'autorise pas la restauration d'un consentement dans un autre onglet.

Le rappel devient éligible 24 heures après le début ou la reprise du paiement, puis pendant la plage 09 h–19 h Europe/Paris. Le planificateur vérifie la file toutes les cinq minutes. Les démarches de plus de sept jours sont ignorées. Une nouvelle tentative remplace les rappels encore en attente pour le même produit et, pour une adhésion, le même pratiquant, même lorsque la nouvelle case reste décochée. Deux enfants du même foyer gardent ainsi des suivis distincts. Aucun historique n'est importé dans cette file.

La CNIL classe les relances de panier abandonné parmi les messages de prospection : l'accord spécifique évite d'assimiler la simple création d'un compte ou l'acceptation des CGV à cet accord.

Sources :

- https://www.cnil.fr/fr/faq-recommandation-pixels-courriers-electroniques — question 16.
- https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel

## Vérification avant l'envoi

1. La base vérifie le consentement, la commande, le mode réel, les paiements et l'offre encore disponible. Un premier règlement confirmé, un remboursement ou un litige exclut la relance de paiement initiale.
2. Le worker vérifie l'identité confirmée actuelle et interroge Stripe en lecture seule. Il exige une session expirée et impayée. Une session complète, un paiement en cours ou une réponse incomplète ne déclenchent aucun e-mail.
3. Les autres tentatives récentes pour ce produit sont également vérifiées auprès de Stripe, pour tenir compte d'un paiement dont le webhook n'est pas encore arrivé. Les lectures sont bornées ; un résultat trop volumineux ou invérifiable est différé.
4. Juste avant SMTP, une seconde vérification SQL empêche un envoi après désinscription, paiement enregistré ou nouvelle tentative.
5. Une réservation atomique protège les envois concurrents. La règle limite aussi les rappels à un par destinataire sur 24 heures et à un envoi par commande/source.

La reprise se fait sur le site, jamais sur une ancienne URL Stripe :

| Achat | Destination |
| --- | --- |
| Adhésion, stage, séance payante | Dossier authentifié dans `adhesion.html?espace=1&order=…` ; les conditions de l'offre et du lien tarifaire sont revérifiées |
| Tee-shirts | Formulaire avec les une ou deux tailles présélectionnées ; vérification et nouveau paiement explicites |
| Vidéo | Catalogue vidéo `/#videos`, avec son contrôle d'accès et de paiement existant |

## Envoi et désinscription

L'expéditeur et l'adresse de réponse sont `contact@km16.fr`. Le message est envoyé au client, via le transport SMTP déjà utilisé par KM16. Il ne contient pas de pixel de suivi, de pièce jointe ni de lien de paiement automatique.

Objet : **KM16 — souhaitez-vous reprendre votre demande ?**

```text
Bonjour,

Vous avez commencé une demande pour [titre de l'offre], mais aucun paiement confirmé n'y est encore associé.

Si vous souhaitez poursuivre, vous pouvez retrouver votre demande et vérifier les informations avant de régler :
[lien vers le site KM16]

Nous pouvons vous aider si vous avez rencontré une difficulté. Répondez simplement à cet e-mail ou contactez-nous à contact@km16.fr.

Si vous venez d'effectuer le paiement, ne le recommencez pas : contactez-nous en cas de doute.

Vous ne souhaitez plus donner suite ? Aucune action n'est nécessaire.

L'équipe KM16
contact@km16.fr

Ne plus recevoir de rappels de paiement :
[lien de désinscription]
```

Le lien de désinscription contient un jeton aléatoire de 256 bits dans le fragment de l'URL. Seule son empreinte SHA-256 est enregistrée en base. La page retire ce fragment de la barre d'adresse et attend le clic sur « Arrêter les rappels de paiement ». Cette confirmation évite qu'un simple lecteur de lien désinscrive automatiquement une personne.

La désinscription arrête tous les rappels de paiement de cette adresse, y compris futurs. Elle ne désactive pas les confirmations de commande ou les messages liés au cours d'essai. Une case cochée ultérieurement ne réactive pas automatiquement une adresse désinscrite.

## Architecture et déploiement

- `*_checkout_reminders.sql` : registre privé, arrêts, RPC, droits et critères d'éligibilité.
- `_shared/checkout-reminders.mjs` : enregistrement en deux temps, avant et après la création Stripe.
- Les trois créateurs (`km16-adhesions`, `km16-shirts`, `km16-create-checkout`) enregistrent aussi les tentatives sans consentement, pour remplacer une précédente tentative.
- `km16-checkout-reminders` : contrôle Stripe, identité, désinscription et SMTP. La fonction a `verify_jwt=false` car la désinscription utilise un jeton ; l'exécution de la file requiert le secret d'automatisation vérifié côté serveur.
- `*_schedule_checkout_reminders.sql` : appel privé par `pg_cron`/`pg_net`, via le jeton existant et le commutateur global de l'automatisation KM16.
- La page de désinscription et les cases sont publiées avec le site GitHub Pages.

Les RPC sont `SECURITY INVOKER`, avec `search_path` vide et droit `EXECUTE` limité à `service_role`. Les deux tables privées ont RLS activée et aucun accès `anon`/`authenticated`. Seul le dispatcher du planificateur est `SECURITY DEFINER`, propriétaire `postgres`, non exécutable par les rôles API.

Ordre de livraison : tests isolés et CI, migration du registre, worker, créateurs avec leur helper partagé, publication du site et activation du planificateur. Les noms de migrations du dépôt doivent correspondre aux versions effectivement enregistrées en production.

## Suivi des résultats

| État | Signification et suite |
| --- | --- |
| `preparing` | Une création de paiement est en préparation ; jamais envoyable tant que la session Stripe n'est pas attachée |
| `pending` | En attente du délai ou d'une nouvelle vérification |
| `checking` | Vérification réservée par un worker ; une réservation expirée peut être reprise après dix minutes |
| `sending` | Envoi SMTP commencé ; jamais replacé automatiquement dans la file |
| `accepted` | Serveur SMTP ayant accepté le destinataire ; cela ne prouve pas l'arrivée dans la boîte de réception |
| `failed` | Refus ou erreur SMTP identifiée ; aucune nouvelle tentative automatique |
| `uncertain` | Résultat d'envoi ambigu, persistance échouée ou envoi resté ouvert plus de quinze minutes ; aucune nouvelle tentative automatique |
| `skipped` | Absence d'accord, paiement, remplacement, désinscription, offre expirée ou autre cause d'exclusion |

Les incidents de vérification avant SMTP peuvent être différés d'une heure. Les résultats de la fonction et du planificateur sont des compteurs et codes sobres, sans adresse e-mail ni secret. Le worker lit Stripe ; il ne crée, n'annule, ne rembourse et ne confirme aucun paiement.

Tests : créateurs réels avec dépendances interceptées, classification des réponses Stripe, transport SMTP fictif, désinscription, critères et permissions PostgreSQL, concurrence de deux connexions et parcours navigateur Chromium/WebKit en CI. Les tests de livraison ne doivent déclencher aucun envoi réel ni créer de commande réelle.

## Cours d'essai

Le message de bienvenue fait l'objet de trois propositions séparées à choisir. Cette livraison n'active pas un modèle de bienvenue supplémentaire. Lors de son activation, harmoniser aussi les mentions existantes de validation préalable dans le catalogue et la page du cours d'essai avec la nouvelle règle souhaitée : choisir librement une séance adaptée dans le planning publié.
