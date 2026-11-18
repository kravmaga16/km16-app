# KM16 — Préparation des relances d’e-mails

Périmètre : consultation administrative des alertes, sans envoi ni modification de statut. Le code, les vérifications et le suivi de mise en service sont regroupés dans la PR n°26.

Un [journal administratif séparé](admin-email-review-journal.md) complète cette consultation. Ses écritures portent uniquement sur les vérifications et décisions, jamais sur les statuts de livraison ; la fonction de consultation ci-dessous reste en lecture seule.

## Comportement attendu

| État | Condition | Action affichée |
| --- | --- | --- |
| `failed` | Toutes les notifications en échec | Validation administrative requise |
| `sending` | `attempted_at` strictement antérieur au seuil de quinze minutes | Blocage à vérifier |
| `uncertain` | Toutes les notifications de livraison incertaine | Vérification manuelle obligatoire |

`pending`, `accepted`, `sending` récent et `sending` exactement au seuil sont exclus. Un `sending` sans date de tentative est également exclu ; son signalement comme anomalie distincte reste hors de cette étape.

Les sources sont `public.km16_admin_purchase_notifications` (achats) et `public.km16_scheduled_mail_deliveries` (e-mails programmés). Les règles sont identiques dans la fonction SQL de préparation et dans le filtre de lecture de la fonction serveur.

## Fonction SQL préparée

`supabase/sql/km16_preparer_relances.sql` définit `public.km16_preparer_relances()`, en `LANGUAGE SQL STABLE SECURITY INVOKER`, avec un `search_path` vide. Elle retourne les alertes sans écrire dans les tables. L’exécution est retirée à `PUBLIC`, `anon` et `authenticated`, puis accordée à `service_role`. Ce rôle doit aussi posséder les droits de lecture nécessaires sur les tables : `EXECUTE` seul ne suffit pas.

Ce fichier est un livrable de préparation, situé hors de `supabase/migrations` : il n’est pas installé automatiquement. Une éventuelle installation devra s’effectuer dans une seule transaction pour rendre la création et les permissions atomiques.

`tests/email-relances-postgres.sql` est réservé à la base isolée `email_relances_test`. Il prépare des tables et des identités fictives, charge la fonction, vérifie les trois règles, les permissions et l’absence de changement des données, puis annule les objets de test avec `ROLLBACK`. Il ne charge ni planificateur, ni worker d’envoi, ni migration de production.

## Consultation dans l’administration

Le panneau est caché avant la connexion et pour les utilisateurs non administrateurs. Le chargement commence uniquement au clic sur « Consulter les alertes ». Aucun bouton de renvoi n’est fourni.

Les valeurs sont affichées comme texte ; une référence contenant du HTML ne peut pas devenir un élément de la page. Les filtres s’appliquent aux pages déjà chargées ; l’interface indique le nombre affiché, le nombre chargé et l’existence d’une page suivante. Une erreur de rafraîchissement efface les anciennes lignes ; une erreur de page suivante conserve les pages précédentes en indiquant que la lecture est incomplète. Un refus d’accès efface les données, y compris pendant la pagination.

Tout changement de session annule la requête en cours, efface les données et réactive les commandes. Une réponse tardive est ignorée. La déconnexion efface immédiatement les adresses, avant même la fin de l’appel de déconnexion.

## Autorisation et données privées

La fonction serveur `km16-admin-email-alerts` accepte uniquement `POST` depuis l’origine `https://app.km16.fr`, avec un prévol `OPTIONS` dédié. Elle vérifie le jeton auprès de Supabase Auth via `getUser(token)`, puis applique la convention administrateur KM16 actuelle : adresse autorisée confirmée et compte non anonyme. L’adresse affichée dans une session locale ne constitue pas l’autorisation serveur.

La configuration de déploiement utilise `verify_jwt = false` au niveau de la passerelle ; le contrôle de session demeure obligatoire dans la fonction, avant toute lecture privilégiée. Ce choix est reproduit dans le test d’intégration complet. Il évite de dépendre de la compatibilité de l’ancien contrôle de passerelle avec les clés Auth asymétriques et la clé publique moderne du projet. Le 18 novembre 2026, le projet publiait une clé de signature ES256 et toutes ses fonctions existantes utilisaient cette configuration. Les documentations Supabase [sur les en-têtes d’authentification](https://supabase.com/docs/guides/functions/auth-headers) et [sur les erreurs 401](https://supabase.com/kb/troubleshooting/edge-function-401-error-response) décrivent différemment cette compatibilité ; l’autorisation du module repose explicitement sur `getUser`, puis sur l’identité administrateur vérifiée, et non sur une simple lecture du JWT.

La clé `service_role` reste dans l’environnement serveur. Aucune clé secrète n’est placée dans les fichiers clients. Le navigateur reçoit uniquement les colonnes nécessaires à la liste, après autorisation. Les réponses portent `Cache-Control: no-store`. Les erreurs publiques ne renvoient pas les détails du fournisseur.

La fonction serveur lit directement les deux tables via le SDK Supabase ; elle ne dépend pas de l’installation de la fonction SQL de préparation. Les contrôles SQL et ceux du handler restent donc distincts.

Le contrôle de métadonnées réalisé le 18 novembre 2026 sur KM16-Videos a confirmé les colonnes nécessaires, la présence de RLS et les droits SELECT attendus : refus pour `anon`/`authenticated`, autorisation pour `service_role`. Ce contrôle ne lisait pas le contenu des notifications et ne constitue pas un test de la nouvelle fonction déployée.

## Pagination

Chaque réponse contient au maximum 100 alertes de chaque source. Le serveur lit une ligne supplémentaire pour annoncer la page suivante. Il avance à partir du dernier identifiant de chaque source, ce qui évite de sauter la prochaine alerte lorsqu’une ligne déjà lue quitte le filtre. Le navigateur déduplique sur le couple catégorie/identifiant.

Première requête : `{ "page": 0 }`. La réponse contient `alerts`, `page`, `has_more` et un `cursor` formé de `observed_at`, `purchases_after` et `campaigns_after`. Les requêtes suivantes renvoient ce curseur avec le numéro de page suivant. Le seuil temporel reste fixe pendant ce parcours. Les curseurs invalides et les identifiants numériques non représentables exactement sont refusés.

Il s’agit d’une lecture évolutive, pas d’un instantané transactionnel. Une alerte qui apparaît avec un identifiant déjà parcouru sera visible au prochain rafraîchissement. Une ligne déjà affichée peut également changer de statut entre deux lectures. La liste ne doit donc jamais servir seule d’autorisation de renvoi.

## Vérifications reproductibles et limites

- `node --test tests/email-relances-contract.test.mjs tests/email-relances-behavior.test.mjs` : contrat statique et exécution du vrai handler avec Auth/base simulés, couvrant les accès refusés, CORS, les règles et seuils, la pagination lorsque les états changent, les erreurs et l’absence de mutation.
- `node --test tests/email-relances-ui.test.mjs` : page et modules réels dans Chromium et WebKit, avec comptes et API fictifs et tout trafic externe bloqué. Vérifie notamment les changements de session, les réponses tardives, les erreurs, le filtrage, la déduplication, le texte hostile et l’affichage mobile.
- `psql -X -P pager=off -v ON_ERROR_STOP=1 -f tests/email-relances-postgres.sql` dans la base isolée : règles SQL, permissions, lecture seule et annulation des objets de test.
- Les tests navigateur utilisent l’image officielle Playwright versionnée déjà adoptée dans `main`, pour éviter de retélécharger les dépendances système lors de chaque exécution.

Le précédent essai sur le Mac s’est arrêté sur un fichier introuvable ; aucun résultat SQL réussi n’a été fourni dans la conversation. L’ancienne mention de « 14 scénarios conformes transmis par l’utilisateur » était non étayée et a été supprimée. Seuls les résultats des commandes et des exécutions CI effectivement terminées font foi.

Les tests PostgreSQL « Phase 14 » du dépôt concernent un autre module. Ils ne prouvent pas le fonctionnement de ces relances. De même, les tests avec Auth simulé ne remplacent pas un essai de la chaîne Supabase Auth/PostgREST/Edge complète.

## Mise en service et évolution

La PR n°26 consigne les contrôles CI et la mise en service. Les paramètres du projet hébergé sont vérifiés avant le déploiement de la fonction : URL, clé publique utilisée par le client, schéma, droits de lecture et existence du compte administrateur confirmé. Les essais d’accès refusé après déploiement ne remplacent pas l’observation de l’interface avec une session administrateur réelle. Un futur renvoi nécessitera une nouvelle lecture du statut, une décision administrative tracée et une protection contre les doublons.

## Intégration complète dans une instance jetable

Le workflow `email-relances-integration.yml` démarre une vraie instance locale Supabase avec la CLI versionnée `3.2.0`, PostgreSQL 17, Auth, PostgREST, la passerelle et le moteur Edge. Il copie le code exact de `km16-admin-email-alerts`, utilise `verify_jwt = false` comme le déploiement prévu et exige la validation de session dans le handler. Il n’utilise aucun projet hébergé, lien distant ni secret de production. Seules les tables fictives nécessaires sont créées ; les migrations KM16 et les workers d’envoi sont absents.

`node tests/email-relances-integration.mjs` crée deux identités de test via l’API administrative locale, avec confirmation immédiate, puis obtient leurs vrais jetons par connexion avec mot de passe. Il vérifie les refus d’accès directs aux tables, les refus de jetons absents/falsifiés et de membre non autorisé, CORS, le seuil exact des quinze minutes, la pagination de 218 alertes, les entrées invalides et le refus d’un jeton dont l’utilisateur local a été supprimé. Les empreintes des trois tables doivent rester identiques et la boîte de capture Mailpit doit rester vide. Le workflow détruit l’instance et ses volumes en fin d’exécution.

Le test exige des adresses `127.0.0.1` sur les ports réservés, refuse les redirections et les options de connexion cachées dans les URL, et refuse une base Auth déjà peuplée ou des tables KM16 existantes. Il vérifie donc la chaîne réelle des composants dans un environnement isolé. Une réussite ne vaut pas validation des paramètres propres à un projet Supabase hébergé ; son résultat est consigné dans les exécutions CI et dans la PR.
