# Bienvenue pour les cours d’essai KM16

Texte nº 1 choisi par Alexandre le 20 novembre 2026. L’objet est « Bienvenue chez KM16 — votre cours d’essai vous attend ! ». Le corps exact se trouve dans `supabase/functions/km16-trial-welcome/handler.mjs`.

## Parcours

Une nouvelle demande réelle pour `essai` ou `essai-saint-jean`, à zéro euro, inscrit automatiquement un message dans une file privée dans la même transaction que le dossier. Le texte confirme l’enregistrement, invite à choisir librement une séance du planning adaptée au pratiquant, puis à se présenter à l’enseignant. Il ne demande pas d’attendre la validation d’un créneau.

L’adresse de contact est celle du compte confirmé utilisé pour la demande. Pour un mineur, le formulaire demande les coordonnées du parent ou représentant légal. Le worker vérifie à nouveau le compte et l’adresse avant l’envoi. Il envoie depuis `KM16 <contact@km16.fr>`, avec réponse à `contact@km16.fr` et le lien `https://app.km16.fr/#planning`.

Le planificateur traite un message par minute. Une demande n’est pas marquée comme un cours déjà effectué. Les présences et les rappels après l’essai gardent leur fonctionnement existant.

## Protection contre les doublons

- Pas d’import des anciens dossiers : seuls les nouveaux INSERT déclenchent la file.
- Une seule entrée par dossier et par pratiquant/compte/saison, même en cas de nouvelle demande sous l’autre identifiant d’essai.
- Les dossiers payants, les tests et les demandes refusées sont exclus.
- Les workers concurrents réservent des lignes différentes avec `FOR UPDATE SKIP LOCKED`.
- Une tentative SMTP dont le résultat est incertain n’est jamais relancée automatiquement.

Les deux RPC de traitement sont `SECURITY INVOKER`, sans accès `anon` ou `authenticated`. La table a RLS activée. Le trigger d’écriture et le dispatcher du planificateur ont les seuls privilèges internes nécessaires ; leurs droits d’exécution publics sont révoqués.

## État de livraison

`accepted` signifie que le serveur SMTP a accepté le destinataire ; cela ne prouve pas l’arrivée dans la boîte de réception. `failed` signale une erreur avant l’envoi ou un refus SMTP. `uncertain` signale une interruption, un délai dépassé ou une impossibilité de confirmer le résultat. Un envoi resté ouvert quinze minutes devient `uncertain`, sans renvoi automatique. Le journal ne contient pas de secret et les réponses HTTP donnent uniquement des compteurs et des codes d’erreur.

Le commutateur global `km16_automation_settings.enabled` et le jeton interne existant contrôlent le worker. Un navigateur public ne peut pas lancer le traitement de la file.

## Publication

1. Vérifier les tests isolés et les parcours client.
2. Installer la file et ses fonctions sans planification.
3. Déployer `km16-trial-welcome` avec `index.ts` et `handler.mjs`.
4. Publier les textes cohérents du parcours et la nouvelle version des conditions, en conservant les archives précédentes.
5. Activer le planificateur et vérifier son premier passage.

Les tests utilisent uniquement des destinataires fictifs et un transport SMTP simulé.
