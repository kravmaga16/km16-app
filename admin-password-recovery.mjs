const projectUrl = 'https://tlfewpbgbwesdriklxzb.supabase.co';
const publishableKey = 'sb_publishable_OGRSgobOGf54jlfmXGmS8g_04Ftvfsn';
const storageKey = 'km16-admin-password-recovery';
const verifierKey = storageKey + '-code-verifier';

function createRecoveryAuth() {
  // The verifier must survive the email round trip. The recovery session stays in this page only.
  const memory = new Map();
  return window.supabase.createClient(projectUrl, publishableKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      autoRefreshToken: false,
      storageKey,
      storage: {
        getItem: key => key === verifierKey ? localStorage.getItem(key) : memory.get(key) ?? null,
        setItem: (key, value) => key === verifierKey ? localStorage.setItem(key, value) : memory.set(key, value),
        removeItem: key => key === verifierKey ? localStorage.removeItem(key) : memory.delete(key),
      },
    },
  }).auth;
}

const requestButton = document.getElementById('request-password-recovery');
if (requestButton) {
  const email = document.getElementById('email');
  const status = document.getElementById('password-recovery-status');
  let auth;

  requestButton.addEventListener('click', async () => {
    email.value = email.value.trim();
    if (!email.reportValidity()) return;

    requestButton.disabled = true;
    status.textContent = 'Envoi de la demande…';
    try {
      auth ??= createRecoveryAuth();
      if (!window.crypto?.subtle) throw new Error('PKCE indisponible');

      const redirectTo = new URL('./admin-password-reset.html', location.href).href;
      await auth.resetPasswordForEmail(email.value, { redirectTo });
      status.textContent = 'Si un compte correspond à cette adresse et que la demande est acceptée, tu recevras un e-mail. Ouvre le lien dans le même navigateur, sur le même appareil.';
    } catch {
      status.textContent = 'La récupération est indisponible dans ce navigateur. Réessaie dans Safari ou Chrome.';
    } finally {
      requestButton.disabled = false;
    }
  });
}

const resetForm = document.getElementById('password-reset-form');
if (resetForm) {
  const status = document.getElementById('password-reset-status');
  const code = new URLSearchParams(location.search).get('code');
  const invalidLink = 'Ce lien est expiré, a déjà servi ou a été ouvert dans un autre navigateur. Demande un nouveau lien depuis la page de connexion.';
  history.replaceState(null, '', location.pathname);

  async function prepareReset() {
    if (!code || !window.crypto?.subtle || !localStorage.getItem(verifierKey)) {
      status.textContent = invalidLink;
      return;
    }

    const auth = createRecoveryAuth();
    const { data, error } = await auth.exchangeCodeForSession(code);
    if (error || data?.redirectType !== 'recovery' || !data.session) {
      status.textContent = invalidLink;
      return;
    }

    const password = resetForm.elements.password;
    const confirmation = resetForm.elements.confirmation;
    const submit = resetForm.querySelector('button[type="submit"]');
    resetForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;

      if (password.value !== confirmation.value) {
        status.textContent = 'Les deux mots de passe doivent être identiques.';
        confirmation.focus();
        return;
      }

      submit.disabled = true;
      status.textContent = 'Enregistrement en cours…';
      try {
        const { error } = await auth.updateUser({ password: password.value });
        if (error) {
          status.textContent = error.code === 'session_not_found' || error.status === 401
            ? invalidLink
            : 'Le mot de passe n’a pas pu être enregistré. Choisis un mot de passe inédit et plus difficile à deviner, puis réessaie.';
          return;
        }

        resetForm.reset();
        resetForm.hidden = true;
        const signedOut = await auth.signOut().then(result => !result.error, () => false);
        status.textContent = signedOut
          ? 'Mot de passe enregistré. Tu peux retourner à la console et te reconnecter.'
          : 'Mot de passe enregistré. La déconnexion des autres sessions n’a pas pu être confirmée.';
      } catch {
        status.textContent = 'L’enregistrement n’a pas pu être confirmé. Réessaie dans quelques instants.';
      } finally {
        submit.disabled = false;
      }
    });

    status.textContent = 'Choisis un nouveau mot de passe pour ton compte KM16.';
    resetForm.hidden = false;
    password.focus();
  }

  prepareReset().catch(() => { status.textContent = invalidLink; });
}
