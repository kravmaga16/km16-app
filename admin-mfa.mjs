export function initAdminMfa(auth, panel) {
  if (!panel) return () => {};
  const add = panel.querySelector('[data-mfa-add]');
  const form = panel.querySelector('form');
  const verify = panel.querySelector('[data-mfa-verify]');
  const code = form.elements.code;
  const factors = form.elements.factor;
  const qr = panel.querySelector('img');
  const status = panel.querySelector('[role="status"]');
  let revision = 0;
  let factorId;

  let enrolling = false;

  function reset() {
    revision++;
    factorId = undefined;
    factors.replaceChildren();
    factors.parentElement.hidden = true;
    enrolling = false;
    verify.hidden = true;
    form.reset();
    form.hidden = true;
    qr.removeAttribute('src');
    qr.hidden = true;
    add.disabled = false;
    form.querySelector('button').disabled = false;
    status.textContent = '';
  }

  function requireData({data, error}) {
    if (error || !data) throw Error('MFA request failed');
    return data;
  }

  panel.addEventListener('toggle', async () => {
    reset();
    if (!panel.open) return;
    const current = revision;
    try {
      const {totp} = requireData(await auth.mfa.listFactors());
      if (current !== revision) return;
      factors.replaceChildren(...totp.map((factor, index) => new Option(factor.friendly_name || `Application ${index + 1}`, factor.id)));
      verify.hidden = !totp.length;
      status.textContent = totp.length
        ? `${totp.length} application(s) d’authentification associée(s).`
        : 'Aucune application d’authentification associée.';
    } catch {
      if (current === revision) status.textContent = 'Impossible de vérifier les applications associées.';
    }
  });

  verify.onclick = () => {
    factorId = undefined;
    factors.parentElement.hidden = factors.options.length < 2;
    form.hidden = false;
    verify.hidden = true;
    add.disabled = true;
    status.textContent = 'Saisissez le code à six chiffres de l’application choisie.';
    code.focus();
  };

  add.onclick = async () => {
    const current = ++revision;
    add.disabled = true;
    verify.hidden = true;
    status.textContent = 'Préparation du code QR…';
    try {
      const factor = requireData(await auth.mfa.enroll({factorType:'totp', issuer:'KM16'}));
      if (current !== revision) return;
      factorId = factor.id;
      enrolling = true;
      qr.src = factor.totp.qr_code;
      qr.hidden = false;
      form.hidden = false;
      status.textContent = 'Scannez le code QR avec votre application, puis saisissez le code à six chiffres.';
      code.focus();
    } catch {
      if (current !== revision) return;
      add.disabled = false;
      verify.hidden = !factors.options.length;
      status.textContent = 'Impossible d’ajouter une application. Réessayez après avoir vérifié votre connexion.';
    }
  };

  form.onsubmit = async event => {
    event.preventDefault();
    const selectedFactor = enrolling ? factorId : factors.value;
    if (!selectedFactor) return;
    const current = revision;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      requireData(await auth.mfa.challengeAndVerify({factorId:selectedFactor, code:code.value.trim()}));
      if (current !== revision) return;
      const message = enrolling
        ? 'Application vérifiée. Vous pouvez associer un appareil de secours.'
        : 'Session vérifiée par double authentification.';
      reset();
      status.textContent = message;
    } catch {
      if (current !== revision) return;
      code.value = '';
      button.disabled = false;
      status.textContent = 'Code refusé ou expiré. Saisissez le code actuel de votre application.';
      code.focus();
    }
  };

  return () => {
    panel.open = false;
    reset();
  };
}
