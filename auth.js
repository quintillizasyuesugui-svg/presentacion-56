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
  //
  // Con allowRegister=true, primero se ven sólo 2 botones para elegir el
  // camino — antes se mostraban los 2 formularios apilados (nombre arriba,
  // "—o—" en el medio, PIN abajo) todo junto, y así entraban de una todos
  // los datos aunque sólo hicieran falta unos pocos.
  function buildGate(allowRegister) {
    const el = document.createElement('div');
    el.className = 'modal-overlay auth-gate';
    el.innerHTML = `
      <div class="modal-card">
        <h2>${allowRegister ? '¿Quién sos?' : 'Ingresá tu PIN'}</h2>
        <p id="authError">${allowRegister ? 'Elegí una opción para entrar.' : 'Es el PIN que te dieron al registrarte desde tu celular.'}</p>

        ${allowRegister ? `
        <div id="authChoice" class="btn-row">
          <button type="button" class="btn primary" id="authChooseNewBtn" style="flex:1">🙋 Soy nuevo/a</button>
          <button type="button" class="btn" id="authChooseOldBtn" style="flex:1">🔑 Ya tengo PIN</button>
        </div>

        <div id="authNew" hidden>
          <input type="text" id="authName" placeholder="Tu nombre" autocomplete="off" maxlength="40">
          <div class="btn-row">
            <button type="button" class="btn primary" id="authRegisterBtn" style="flex:1">Dame un PIN</button>
          </div>
          <button type="button" class="auth-back" id="authBackFromNew">← Volver</button>
        </div>
        ` : ''}

        <div id="authOld" ${allowRegister ? 'hidden' : ''}>
          <input type="password" id="authPin" placeholder="PIN (4 dígitos)" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off">
          <p class="auth-lock-msg" id="authLockMsg" hidden></p>
          <div class="btn-row">
            <button type="button" class="btn primary" id="authLoginBtn" style="flex:1">Entrar</button>
          </div>
          ${allowRegister ? '<button type="button" class="auth-back" id="authBackFromOld">← Volver</button>' : ''}
        </div>
      </div>`;
    return el;
  }

  // Overlay chico y aparte de la puerta de PIN — círculo de puntitos girando
  // 2s antes de completar la acción. Se usa para login y para cerrar sesión;
  // el color distingue cuál es cuál (celeste = entrar, rojo = salir, a tono
  // con el color que ya tiene cada botón). La espera es deliberada (no por
  // una tarea real que tarde eso) porque así lo pidió el usuario. El
  // recorrido en elipse (no un giro 3D real) de cada puntito vive en
  // style.css (ver .auth-spinner / @keyframes authSpinnerOrbit).
  function showActionSpinner(color, label) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay auth-spinner-overlay';
      overlay.innerHTML = `
        <div class="auth-spinner-box">
          <div class="auth-spinner ${color}"><span></span><span></span><span></span></div>
          <p>${label}</p>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      setTimeout(() => {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.remove(); resolve(); }, 200);
      }, 2000);
    });
  }

  // Límite de intentos de PIN: 3 seguidos mal → 10s de espera con cuenta
  // regresiva. Vive en localStorage (no en una variable) para que sobreviva
  // a un refresh de página — si no, alcanzaba con recargar para saltearlo.
  const LOCK_KEY = 'presentacionAuthLock';
  const MAX_ATTEMPTS = 3;
  const LOCK_MS = 10000;

  function getLock() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { attempts: 0, lockUntil: 0 }; }
    catch { return { attempts: 0, lockUntil: 0 }; }
  }
  function setLock(lock) {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(lock)); } catch { /* privado/bloqueado */ }
  }
  function clearLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch { /* privado/bloqueado */ }
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
      // Sólo existen cuando allowRegister es true (ver buildGate) — null en pantalla.html.
      const choiceBox = gate.querySelector('#authChoice');
      const authNewBox = gate.querySelector('#authNew');
      const authOldBox = gate.querySelector('#authOld');
      const chooseNewBtn = gate.querySelector('#authChooseNewBtn');
      const chooseOldBtn = gate.querySelector('#authChooseOldBtn');
      const backFromNew = gate.querySelector('#authBackFromNew');
      const backFromOld = gate.querySelector('#authBackFromOld');
      const lockMsg = gate.querySelector('#authLockMsg');
      requestAnimationFrame(() => gate.classList.add('show'));

      // Arranca mostrando sólo los 2 botones de elección; el formulario
      // correspondiente (nombre o PIN) recién aparece al elegir uno.
      function showChoice() {
        choiceBox.hidden = false;
        authNewBox.hidden = true;
        authOldBox.hidden = true;
        errorEl.textContent = 'Elegí una opción para entrar.';
      }
      function showNewForm() {
        choiceBox.hidden = true;
        authNewBox.hidden = false;
        errorEl.textContent = '';
        nameInput.focus();
      }
      function showOldForm() {
        choiceBox.hidden = true;
        authOldBox.hidden = false;
        errorEl.textContent = '';
        applyLockState();
        if (!pinInput.disabled) pinInput.focus();
      }
      if (chooseNewBtn) chooseNewBtn.addEventListener('click', showNewForm);
      if (chooseOldBtn) chooseOldBtn.addEventListener('click', showOldForm);
      if (backFromNew) backFromNew.addEventListener('click', showChoice);
      if (backFromOld) backFromOld.addEventListener('click', showChoice);

      // Refleja el bloqueo por intentos fallidos (si hay uno vigente, incluso
      // de antes de recargar la página) y arranca/actualiza la cuenta
      // regresiva de a un segundo hasta que se cumpla.
      let lockInterval = null;
      function applyLockState() {
        const lock = getLock();
        const remaining = lock.lockUntil - Date.now();
        if (remaining <= 0) {
          if (lockInterval) { clearInterval(lockInterval); lockInterval = null; }
          pinInput.disabled = false;
          loginBtn.disabled = false;
          lockMsg.hidden = true;
          return false;
        }
        pinInput.disabled = true;
        loginBtn.disabled = true;
        lockMsg.hidden = false;
        lockMsg.textContent = `Muchos intentos — esperá ${Math.ceil(remaining / 1000)}s para volver a probar.`;
        if (!lockInterval) {
          lockInterval = setInterval(() => {
            if (!applyLockState()) return; // ya se cumplió el tiempo, se reactivó solo
          }, 250);
        }
        return true;
      }
      applyLockState(); // por si authOld ya está visible de arranque (pantalla.html)

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
        if (applyLockState()) return; // ya debería estar disabled, esto es por las dudas
        const pin = pinInput.value.trim();
        if (!pin) { errorEl.textContent = 'Escribí tu PIN.'; return; }
        loginBtn.disabled = true;
        pinInput.disabled = true;
        const spinnerDone = showActionSpinner('blue', 'Entrando…');
        let auth, error;
        try {
          // /api/auth/login no devuelve el pin (no hace falta, el server ya lo
          // validó) — hay que pegarlo nosotros antes de guardar, si no
          // authFetch se queda sin PIN para mandar en el próximo pedido.
          auth = await callAuth('/api/auth/login', { pin });
        } catch (err) {
          error = err;
        }
        await spinnerDone; // el spinner tarda sus 5s igual, sea rápido o lento el pedido real

        if (!error) {
          clearLock();
          finish(Object.assign({}, auth, { pin }));
          return;
        }

        pinInput.value = '';
        const lock = getLock();
        lock.attempts = (lock.attempts || 0) + 1;
        if (lock.attempts >= MAX_ATTEMPTS) {
          setLock({ attempts: 0, lockUntil: Date.now() + LOCK_MS });
          errorEl.textContent = 'Muchos intentos fallidos.';
          applyLockState();
        } else {
          setLock(lock);
          const left = MAX_ATTEMPTS - lock.attempts;
          errorEl.textContent = error.message + ` (te quedan ${left} intento${left === 1 ? '' : 's'})`;
          pinInput.disabled = false;
          loginBtn.disabled = false;
          pinInput.focus();
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
    showActionSpinner('red', 'Cerrando sesión…').then(() => {
      clearStored();
      authPromise = null;
      location.reload();
    });
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
