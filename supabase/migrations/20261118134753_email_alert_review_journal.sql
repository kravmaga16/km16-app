-- KM16 : journal de décisions administratives, distinct des statuts de livraison.
-- Appliquer ce fichier dans une transaction unique (psql -1 ou migration Supabase).
-- Aucun envoi, aucune remise en attente, aucun INSERT/UPDATE/DELETE sur les sources.

CREATE TABLE public.km16_email_alert_reviews (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id uuid NOT NULL UNIQUE,
    categorie text NOT NULL CHECK (categorie IN ('achats', 'emails_programmes')),
    notification_id bigint NOT NULL CHECK (notification_id > 0),
    decision text NOT NULL CHECK (decision IN (
        'verification_effectuee', 'a_reexaminer', 'ne_pas_relancer'
    )),
    note text NOT NULL CHECK (
        char_length(note) BETWEEN 3 AND 1000
        AND note = regexp_replace(note, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    ),
    observed_state text NOT NULL CHECK (observed_state IN ('failed', 'uncertain', 'sending')),
    observed_attempted_at timestamptz,
    previous_review_id bigint NOT NULL CHECK (previous_review_id >= 0),
    recorded_by uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX km16_email_alert_reviews_notification_idx
    ON public.km16_email_alert_reviews (categorie, notification_id, id DESC);

ALTER TABLE public.km16_email_alert_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.km16_email_alert_reviews
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.km16_email_alert_reviews TO service_role;
REVOKE ALL ON SEQUENCE public.km16_email_alert_reviews_id_seq
    FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.km16_email_alert_reviews_id_seq TO service_role;

COMMENT ON TABLE public.km16_email_alert_reviews IS
    'Journal administratif append-only. Aucune décision ne rend un e-mail renvoyable.';

CREATE OR REPLACE FUNCTION public.km16_record_email_alert_review(
    p_request_id uuid,
    p_categorie text,
    p_notification_id bigint,
    p_expected_state text,
    p_expected_attempted_at timestamptz,
    p_expected_last_review_id bigint,
    p_decision text,
    p_note text,
    p_actor_id uuid
)
RETURNS SETOF public.km16_email_alert_reviews
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.km16_email_alert_reviews%ROWTYPE;
    v_created public.km16_email_alert_reviews%ROWTYPE;
    v_state text;
    v_attempted_at timestamptz;
    v_latest_id bigint;
    v_note text;
BEGIN
    -- L'identité provient exclusivement du getUser vérifié dans l'Edge Function.
    -- L'ACL EXECUTE interdit l'appel direct par anon/authenticated.
    v_note := pg_catalog.regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF p_request_id IS NULL OR p_actor_id IS NULL
       OR p_categorie IS NULL OR p_categorie NOT IN ('achats', 'emails_programmes')
       OR p_notification_id IS NULL OR p_notification_id <= 0
       OR p_expected_state IS NULL OR p_expected_state NOT IN ('pending', 'sending', 'accepted', 'failed', 'uncertain')
       OR (p_expected_attempted_at IS NOT NULL AND NOT pg_catalog.isfinite(p_expected_attempted_at))
       OR p_expected_last_review_id IS NULL OR p_expected_last_review_id < 0
       OR p_decision IS NULL OR p_decision NOT IN (
           'verification_effectuee', 'a_reexaminer', 'ne_pas_relancer'
       )
       OR v_note IS NULL OR pg_catalog.char_length(v_note) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION 'Paramètres invalides' USING ERRCODE = '22023';
    END IF;

    -- Un request_id est unique pour tout le journal, même entre deux sources.
    -- L'ordre fixe request_id -> notification évite les inversions de verrouillage.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'km16_email_review_request:' || p_request_id::text, 0
    ));
    SELECT r.* INTO v_existing
    FROM public.km16_email_alert_reviews AS r
    WHERE r.request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.categorie = p_categorie
           AND v_existing.notification_id = p_notification_id
           AND v_existing.observed_state = p_expected_state
           AND v_existing.observed_attempted_at IS NOT DISTINCT FROM p_expected_attempted_at
           AND v_existing.previous_review_id = p_expected_last_review_id
           AND v_existing.decision = p_decision
           AND v_existing.note = v_note
           AND v_existing.recorded_by = p_actor_id THEN
            -- Une réponse perdue peut être rejouée après évolution de la source.
            RETURN NEXT v_existing;
            RETURN;
        END IF;
        RAISE EXCEPTION 'Identifiant de requête déjà utilisé avec un autre contenu'
            USING ERRCODE = 'PT409';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'km16_email_review_notification:' || p_categorie || ':' || p_notification_id::text, 0
    ));
    -- Le verrou SHARE empêche un changement de statut/tentative pendant le contrôle.
    -- Il utilise les droits SELECT+UPDATE déjà présents du rôle de service.
    IF p_categorie = 'achats' THEN
        SELECT n.state, n.attempted_at INTO v_state, v_attempted_at
        FROM public.km16_admin_purchase_notifications AS n
        WHERE n.id = p_notification_id FOR SHARE;
    ELSE
        SELECT d.state, d.attempted_at INTO v_state, v_attempted_at
        FROM public.km16_scheduled_mail_deliveries AS d
        WHERE d.id = p_notification_id FOR SHARE;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Notification introuvable' USING ERRCODE = 'PT404';
    END IF;
    IF v_state IS DISTINCT FROM p_expected_state
       OR v_attempted_at IS DISTINCT FROM p_expected_attempted_at THEN
        RAISE EXCEPTION 'La notification a changé : actualiser les alertes'
            USING ERRCODE = 'PT409';
    END IF;
    IF NOT (
        v_state IN ('failed', 'uncertain')
        OR (v_state = 'sending' AND v_attempted_at IS NOT NULL
            AND v_attempted_at < pg_catalog.now() - interval '15 minutes')
    ) THEN
        RAISE EXCEPTION 'Cette notification ne nécessite plus ce contrôle'
            USING ERRCODE = 'PT409';
    END IF;

    SELECT coalesce(max(r.id), 0) INTO v_latest_id
    FROM public.km16_email_alert_reviews AS r
    WHERE r.categorie = p_categorie AND r.notification_id = p_notification_id;
    IF v_latest_id <> p_expected_last_review_id THEN
        RAISE EXCEPTION 'Le journal a changé : actualiser les vérifications'
            USING ERRCODE = 'PT409';
    END IF;

    INSERT INTO public.km16_email_alert_reviews (
        request_id, categorie, notification_id, decision, note,
        observed_state, observed_attempted_at, previous_review_id,
        recorded_by, recorded_at
    ) VALUES (
        p_request_id, p_categorie, p_notification_id, p_decision, v_note,
        v_state, v_attempted_at, v_latest_id, p_actor_id, pg_catalog.now()
    ) RETURNING * INTO v_created;
    RETURN NEXT v_created;
END;
$function$;

REVOKE ALL ON FUNCTION public.km16_record_email_alert_review(
    uuid, text, bigint, text, timestamptz, bigint, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.km16_record_email_alert_review(
    uuid, text, bigint, text, timestamptz, bigint, text, text, uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';
