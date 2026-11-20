const measurementId = 'G-342F411VV9';
const consentKey = 'km16-analytics-choice-v1';
const consentLifetime = 180 * 24 * 60 * 60 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const stageIdPattern = /^stage-[a-z0-9-]+$/;

export function hasStageAnalyticsConsent() {
  try {
    const choice = JSON.parse(localStorage.getItem(consentKey));
    const age = Date.now() - choice?.at;
    return choice?.value === 'accepted' && Number.isFinite(choice.at)
      && age >= 0 && age < consentLifetime;
  } catch {
    return false;
  }
}

export function prepareStageAnalytics() {
  if (!hasStageAnalyticsConsent() || window.gtag) return;
  const page = new URL('./adhesion.html', location.href).href;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: false, page_location: page, page_referrer: '',
    cookie_expires: 15552000, cookie_update: false,
    allow_google_signals: false, allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
}

export function trackStageSignupClick(stageDate, placement) {
  if (!hasStageAnalyticsConsent() || !datePattern.test(stageDate)) return;
  try {
    window.gtag?.('event', 'km16_stage_signup_click', {
      stage_date: stageDate, placement, send_to: measurementId,
    });
  } catch {}
}

export function stageReminderSource(value) {
  return ['email-j7', 'email-j3', 'push-48h'].includes(value) ? value : undefined;
}

export function trackStageReminderVisit(stage, source) {
  const stageSource = stageReminderSource(source);
  if (!stageSource || !hasStageAnalyticsConsent() || stage?.category !== 'Stages'
    || !stageIdPattern.test(stage.id) || !datePattern.test(stage.event_date)) return;
  try {
    prepareStageAnalytics();
    window.gtag('event', 'km16_stage_reminder_visit', {
      stage_id: stage.id, stage_date: stage.event_date, stage_source: stageSource,
      send_to: measurementId,
    });
  } catch {}
}

export async function trackStageCheckout(stage, source) {
  if (stage?.category !== 'Stages' || !hasStageAnalyticsConsent()
    || !stageIdPattern.test(stage.id) || !datePattern.test(stage.event_date)) return;
  const stageSource = stageReminderSource(source);
  try {
    prepareStageAnalytics();
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 400);
      window.gtag('event', 'km16_stage_stripe_redirect', {
        stage_id: stage.id, stage_date: stage.event_date, send_to: measurementId,
        ...(stageSource ? {stage_source: stageSource} : {}),
        page_location: new URL('./adhesion.html', location.href).href, page_referrer: '',
        event_timeout: 400,
        event_callback: () => { clearTimeout(timeout); resolve(); },
      });
    });
  } catch {}
}

const purchaseSteps = new Set(['formula_chosen','form_completed','checkout_opened','payment_confirmed']);
export async function trackMembershipStep(step) {
  if (!purchaseSteps.has(step) || !hasStageAnalyticsConsent()) return;
  try {
    prepareStageAnalytics();
    if (step !== 'checkout_opened') {
      window.gtag('event', 'km16_membership_' + step, {send_to: measurementId});
      return;
    }
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 400);
      window.gtag('event', 'km16_membership_' + step, {
        send_to: measurementId, event_timeout:400,
        event_callback: () => { clearTimeout(timeout); resolve(); },
      });
    });
  } catch {}
}
