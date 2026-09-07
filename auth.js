// auth.js — PIN por persona para manage.html y avanzado.html.
// El sistema da el PIN solo (registro con nombre, 4 dígitos únicos) y el
// celular lo recuerda (localStorage) — no hay que pedirlo cada vez.
(function () {
  const STORAGE_KEY = 'presentacionAuth';

  function getStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }
  function setStored(auth) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(auth)); } catch { /* privado/bloqueado */ }
  }
  function clearStored() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* privado/bloqueado */ }
  }

  async function callAuth(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de autenticación.');
    return data;
  }

  // allowRegister=false arma sólo el bloque de PIN, sin "Soy nuevo/a" — para
  // pantalla.html: en el proyector/TV no tiene sentido dar de alta gente
  // nueva, eso se hace desde el propio celular (control.html/manage.html).
  function buildGate(allowRegister) {
    const el = document.createElement('div');
    el.className = 'modal-overlay auth-gate';
    el.innerHTML = `
      <div class="modal-card">
        <h2>${allowRegister ? '¿Quién sos?' : 'Ingresá tu PIN'}</h2>
        <p id="authError">${allowRegister ? 'Elegí una opción para entrar.' : 'Es el PIN que te dieron al registrarte desde tu celular.'}</p>

        ${allowRegister ? `
        <div id="authNew">
          <input type="text" id="authName" placeholder="Tu nombre" autocomplete="off" maxlength="40">
          <div class="btn-row">
            <button type="button" class="btn primary" id="authRegisterBtn" style="flex:1">Soy nuevo/a — dame un PIN</button>
          </div>
        </div>

        <p class="auth-divider">— o —</p>
        ` : ''}

        <div id="authOld">
          <input type="password" id="authPin" placeholder="PIN (4 dígitos)" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">
          <div class="btn-row">
            <button type="button" class="btn primary" id="authLoginBtn" style="flex:1">Entrar</button>
          </div>
        </div>
      </div>`;
    return el;
  }

  function showGate(opts = {}) {
    const allowRegister = opts.allowRegister !== false;
    return new Promise((resolve) => {
      const gate = buildGate(allowRegister);
      document.body.appendChild(gate);
      const errorEl = gate.querySelector('#authError');
      const nameInput = gate.querySelector('#authName'); // null si allowRegister es false
      const pinInput = gate.querySelector('#authPin');
      const registerBtn = gate.querySelector('#authRegisterBtn'); // ídem
      const loginBtn = gate.querySelector('#authLoginBtn');
      requestAnimationFrame(() => gate.classList.add('show'));

      function finish(auth) {
        setStored(auth);
        gate.classList.remove('show');
        setTimeout(() => gate.remove(), 200);
        resolve(auth);
      }

      function showPinOnce(auth) {
        // El PIN sólo se muestra en este momento — después queda guardado en
        // el celular y no hace falta volver a escribirlo en este dispositivo.
        errorEl.innerHTML = `¡Listo, ${auth.name}! Tu PIN es <strong>${auth.pin}</strong> — anotalo, te sirve para entrar desde otro celular.`;
        if (registerBtn) registerBtn.disabled = true;
        loginBtn.disabled = true;
        if (nameInput) nameInput.disabled = true;
        pinInput.disabled = true;
        setTimeout(() => finish(auth), 2600);
      }

      if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
          const name = nameInput.value.trim();
          if (!name) { errorEl.textContent = 'Escribí tu nombre primero.'; return; }
          registerBtn.disabled = true;
          try {
            const auth = await callAuth('/api/auth/register', { name });
            showPinOnce(auth);
          } catch (err) {
            errorEl.textContent = err.message;
            registerBtn.disabled = false;
          }
        });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') registerBtn.click(); });
      }

      loginBtn.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (!pin) { errorEl.textContent = 'Escribí tu PIN.'; return; }
        loginBtn.disabled = true;
        try {
          // /api/auth/login no devuelve el pin (no hace falta, el server ya lo
          // validó) — hay que pegarlo nosotros antes de guardar, si no
          // authFetch se queda sin PIN para mandar en el próximo pedido.
          const auth = await callAuth('/api/auth/login', { pin });
          finish(Object.assign({}, auth, { pin }));
        } catch (err) {
          errorEl.textContent = err.message;
          pinInput.value = '';
          loginBtn.disabled = false;
        }
      });

      pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
    });
  }

  let authPromise = null;
  let lastGateOpts = undefined; // para que un reintento tras 401 respete el mismo modo de puerta

  // Se resuelve con { pin, name, isAdmin } una vez identificado. Pasar
  // { allowRegister: false } muestra sólo el ingreso por PIN (pantalla.html).
  window.ensureAuthed = function ensureAuthed(opts) {
    if (opts !== undefined) lastGateOpts = opts;
    if (authPromise) return authPromise;
    authPromise = (async () => {
      const stored = getStored();
      if (stored) {
        try {
          const fresh = await callAuth('/api/auth/login', { pin: stored.pin });
          const auth = Object.assign({}, fresh, { pin: stored.pin });
          setStored(auth);
          return auth;
        } catch {
          clearStored(); // el PIN ya no sirve (ej. people.json se reinició)
        }
      }
      return showGate(lastGateOpts);
    })();
    return authPromise;
  };

  window.getAuth = getStored;

  // Texto del cartelito con nombre (+ PIN, para quien lo perdió o quiere
  // pasarlo a otro celular). El PIN NO se muestra en pantalla.html — ese
  // dispositivo lo puede estar viendo toda la sala, no sólo su dueño.
  window.authBadgeText = function authBadgeText(auth, { showPin = true } = {}) {
    return '👤 ' + auth.name + (auth.isAdmin ? ' (todas)' : '') + (showPin ? ' · PIN ' + auth.pin : '');
  };

  window.logoutAuth = function logoutAuth() {
    clearStored();
    authPromise = null;
    location.reload();
  };

  // Wrapper de fetch: agrega el PIN guardado como header y, si el server
  // contesta 401 (PIN vencido/borrado), vuelve a pedirlo y reintenta una vez.
  window.authFetch = async function authFetch(url, options = {}) {
    const auth = getStored();
    const headers = Object.assign({}, options.headers, auth ? { 'x-pin': auth.pin } : {});
    let res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      clearStored();
      authPromise = null;
      const fresh = await window.ensureAuthed();
      const retryHeaders = Object.assign({}, options.headers, fresh ? { 'x-pin': fresh.pin } : {});
      res = await fetch(url, Object.assign({}, options, { headers: retryHeaders }));
    }
    return res;
  };
})();
