/* Login, registration and forgot-password pages. */
(function () {
  const $ = (sel) => document.querySelector(sel);

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
  }

  // Password visibility toggles
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  });

  const setFieldError = (form, name, msg) => {
    const el = form.querySelector(`[data-error="${name}"]`);
    if (el) el.textContent = msg || '';
    const input = form.elements[name];
    if (input) input.classList.toggle('invalid', !!msg);
  };
  const setFormError = (form, msg) => {
    const box = form.querySelector('.form-error');
    if (box) box.textContent = msg || '';
  };
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  /* ---------- Login ---------- */
  const loginForm = $('#login-form');
  if (loginForm) {
    document.querySelectorAll('[data-demo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        loginForm.elements.email.value = btn.dataset.email;
        loginForm.elements.password.value = btn.dataset.password;
        setFormError(loginForm, '');
        toast(`Demo account filled: ${btn.dataset.email}`);
      });
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = loginForm.elements.email.value.trim();
      const password = loginForm.elements.password.value;
      let valid = true;
      setFieldError(loginForm, 'email', emailOk(email) ? '' : 'Enter a valid email address.');
      if (!emailOk(email)) valid = false;
      setFieldError(loginForm, 'password', password ? '' : 'Password is required.');
      if (!password) valid = false;
      if (!valid) return;

      const btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const res = await API.post('/auth/login', { email, password });
        Session.save(res.token, res.user);
        location.href = 'app.html';
      } catch (err) {
        setFormError(loginForm, err.message);
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
  }

  /* ---------- Register ---------- */
  const registerForm = $('#register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = registerForm.elements;
      const values = {
        name: f.name.value.trim(), email: f.email.value.trim(), flat: f.flat.value.trim(),
        building: f.building.value.trim(), password: f.password.value, confirm: f.confirm.value
      };
      const checks = {
        name: values.name.length >= 2 ? '' : 'Name must be at least 2 characters.',
        email: emailOk(values.email) ? '' : 'Enter a valid email address.',
        flat: values.flat ? '' : 'Flat or apartment number is required.',
        password: values.password.length >= 8 ? '' : 'Password must be at least 8 characters.',
        confirm: values.confirm === values.password ? '' : 'Passwords do not match.'
      };
      Object.entries(checks).forEach(([k, msg]) => setFieldError(registerForm, k, msg));
      if (Object.values(checks).some(Boolean)) return;

      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Creating account…';
      try {
        const res = await API.post('/auth/register', {
          name: values.name, email: values.email, flat: values.flat,
          building: values.building, password: values.password
        });
        Session.save(res.token, res.user);
        toast('Account created. Welcome aboard!');
        setTimeout(() => { location.href = 'app.html'; }, 600);
      } catch (err) {
        setFormError(registerForm, err.message);
        btn.disabled = false; btn.textContent = 'Create account';
      }
    });
  }

  /* ---------- Forgot password ---------- */
  const forgotForm = $('#forgot-form');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = forgotForm.elements.email.value.trim();
      setFieldError(forgotForm, 'email', emailOk(email) ? '' : 'Enter a valid email address.');
      if (!emailOk(email)) return;
      try {
        const res = await API.post('/auth/forgot', { email });
        $('#forgot-msg').textContent = res.message;
      } catch (err) {
        setFormError(forgotForm, err.message);
      }
    });
  }
})();
