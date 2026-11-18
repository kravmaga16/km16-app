-- KM16 : préparation des relances en lecture seule.
-- Source à examiner, hors des migrations automatiques ; aucun déploiement implicite.
-- Exécuter CREATE + REVOKE + GRANT dans UNE transaction. Pour une installation
-- explicitement décidée : psql -X -v ON_ERROR_STOP=1 --single-transaction -f ce_fichier.
-- Le test tests/email-relances-postgres.sql fournit sa propre transaction annulée.
-- Aucun envoi, aucune validation administrative enregistrée, aucun statut modifié.
-- Les tables et les rôles Supabase doivent déjà exister. Le rôle appelant doit
-- disposer des droits SELECT et des politiques RLS nécessaires sur les deux tables.

CREATE OR REPLACE FUNCTION public.km16_preparer_relances()
RETURNS TABLE (
    categorie text,
    notification_id bigint,
    reference text,
    destinataire text,
    statut text,
    derniere_tentative timestamptz,
    action_requise text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
    SELECT
        'achats'::text,
        n.id,
        n.event_key,
        n.recipient,
        n.state,
        n.attempted_at,
        CASE n.state
            WHEN 'failed' THEN 'validation_requise'
            WHEN 'uncertain' THEN 'verification_manuelle'
            WHEN 'sending' THEN 'blocage_a_verifier'
        END
    FROM public.km16_admin_purchase_notifications AS n
    WHERE n.state IN ('failed', 'uncertain')
       OR (
            n.state = 'sending'
            AND n.attempted_at < pg_catalog.now() - interval '15 minutes'
       )

    UNION ALL

    SELECT
        'emails_programmes'::text,
        d.id,
        d.campaign_id,
        d.email,
        d.state,
        d.attempted_at,
        CASE d.state
            WHEN 'failed' THEN 'validation_requise'
            WHEN 'uncertain' THEN 'verification_manuelle'
            WHEN 'sending' THEN 'blocage_a_verifier'
        END
    FROM public.km16_scheduled_mail_deliveries AS d
    WHERE d.state IN ('failed', 'uncertain')
       OR (
            d.state = 'sending'
            AND d.attempted_at < pg_catalog.now() - interval '15 minutes'
       );
$function$;

REVOKE ALL ON FUNCTION public.km16_preparer_relances()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.km16_preparer_relances()
TO service_role;
