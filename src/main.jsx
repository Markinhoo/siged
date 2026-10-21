import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const layouts = [
  { id: 'SP1', name: 'ANL_CATEGORIAS', desc: 'Catálogo de categorías', icon: '▦' },
  { id: 'SP2', name: 'ANL_PLAZA', desc: 'Plazas vigentes y centros de trabajo', icon: '▤' },
  { id: 'SP3', name: 'MOV_PERSONAL', desc: 'Movimientos de personal', icon: '⇄' },
  { id: 'SP4', name: 'MOV_PLAZA', desc: 'Movimientos de plaza', icon: '⌕' },
  { id: 'SP5', name: 'PAGOS_NÓMINA', desc: 'Pagos de nómina', icon: '$' },
];

async function requestExport(url, payload) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.needsCorrection) return { correction: data };
    throw new Error(data.error || `Error HTTP ${response.status}`);
  }
  return { response };
}

function unresolvedSp5Fields(text) {
  const requiredIndexes = new Set([5, 9, 10, 11]);
  const unresolved = [];
  const separators = text.match(/\r\n|\n|\r/g) || [];
  let offset = 0;
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((line, lineIndex) => {
    if (line) {
      const fields = line.split('|');
      let fieldOffset = 0;
      fields.forEach((field, index) => {
        const trimmed = field.trim();
        if (trimmed.toUpperCase() === 'NULL') {
          unresolved.push({ start: offset + fieldOffset + field.indexOf(trimmed), end: offset + fieldOffset + field.indexOf(trimmed) + trimmed.length });
        } else if (requiredIndexes.has(index) && !trimmed) {
          unresolved.push({ start: offset + fieldOffset, end: offset + fieldOffset });
        }
        fieldOffset += field.length + 1;
      });
    }
    offset += line.length + (separators[lineIndex]?.length || 0);
  });
  return unresolved;
}

async function downloadResponse(response, fileName) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ThemeButton({ theme, onToggle }) {
  return <button className="theme-toggle" type="button" onClick={onToggle} aria-label={theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'} title={theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}>
    <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
    <span>{theme === 'light' ? 'Oscuro' : 'Claro'}</span>
  </button>;
}

function AuthScreen({ theme, onToggleTheme, configured, error, username, setUsername, password, setPassword, busy, onSubmit }) {
  return <main className="shell auth-page">
    <header className="topbar">
      <a className="brand" href="#inicio" aria-label="SIGED">
        <span className="brand-name">Sistema Validador de Layouts Para el SIGED</span>
      </a>
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
    </header>
    {configured ? <form className="login-card" onSubmit={onSubmit}>
      <img className="login-logo" src="/siged-logo.png" alt="Sistema Validador de Layouts para el SIGED" />
      <div className="eyebrow"><span>ACCESO PROTEGIDO</span></div>
      <h1>Iniciar sesión</h1>
      <p className="login-intro">Ingresa tus credenciales para acceder a los layouts de nómina.</p>
      <label htmlFor="login-user">USUARIO</label>
      <input id="login-user" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
      <label htmlFor="login-password">CONTRASEÑA</label>
      <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="primary-button login-submit" disabled={busy || !username || !password}>{busy ? <><span className="spinner" /> Verificando…</> : 'Entrar'}</button>
    </form> : <section className="login-card setup-card">
      <div className="login-lock" aria-hidden="true">⌑</div>
      <div className="eyebrow"><span>CONFIGURACIÓN REQUERIDA</span></div>
      <h1>Configura el acceso</h1>
      <p className="login-intro">Agrega `APP_USERNAME` y una contraseña de al menos 12 caracteres en el archivo `.env`, luego reinicia la aplicación.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
    </section>}
  </main>;
}

function App() {
  const [qna, setQna] = useState('');
  const [qnas, setQnas] = useState([]);
  const [qnaLoading, setQnaLoading] = useState(true);
  const [qnaError, setQnaError] = useState('');
  const [qnaRefresh, setQnaRefresh] = useState(0);
  const [auth, setAuth] = useState({ loading: true, configured: false, authenticated: false, username: '', error: '' });
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('siged-theme') || 'light');
  const [fileNames, setFileNames] = useState({});
  const [formats, setFormats] = useState(() => Object.fromEntries(layouts.map(({ id }) => [id, 'zip'])));
  const [bundleName, setBundleName] = useState('');
  const [busy, setBusy] = useState({});
  const [status, setStatus] = useState({});
  const [sp5Editor, setSp5Editor] = useState(null);
  const [sp5EditorError, setSp5EditorError] = useState('');
  const [sp5EditorBusy, setSp5EditorBusy] = useState(false);
  const sp5EditorRef = useRef(null);
  const valid = qnas.includes(qna);

  useEffect(() => {
    if (!sp5Editor) return;
    requestAnimationFrame(() => {
      const editor = sp5EditorRef.current;
      if (!editor) return;
      const position = unresolvedSp5Fields(sp5Editor.text)[0];
      editor.focus();
      if (position) editor.setSelectionRange(position.start, position.end);
    });
  }, [sp5Editor?.session]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('siged-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
        return data;
      })
      .then((data) => { if (active) setAuth({ ...data, loading: false, error: '' }); })
      .catch((error) => { if (active) setAuth({ loading: false, configured: false, authenticated: false, username: '', error: `No se pudo conectar con el servidor: ${error.message}` }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!auth.authenticated) {
      setQnaLoading(false);
      setQnas([]);
      return () => { active = false; };
    }
    setQnaLoading(true);
    setQnaError('');
    fetch('/api/qnas')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
        return data.qnas || [];
      })
      .then((available) => {
        if (!active) return;
        setQnas(available);
        // El periodo de proceso siempre inicia con la QNA más reciente
        // disponible (por ejemplo, 202701 después de 202620).
        const latest = available.reduce((currentLatest, period) =>
          Number(period) > Number(currentLatest) ? period : currentLatest, '');
        setQna(latest);
      })
      .catch((error) => {
        if (!active) return;
        setQnas([]);
        setQna('');
        setQnaError(error.message);
      })
      .finally(() => { if (active) setQnaLoading(false); });
    return () => { active = false; };
  }, [qnaRefresh, auth.authenticated]);

  async function submitLogin(event) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
      setLoginPassword('');
      setAuth({ loading: false, configured: true, authenticated: true, username: data.username, error: '' });
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuth((current) => ({ ...current, authenticated: false, username: '' }));
    setQnas([]);
    setQna('');
  }

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light');

  if (auth.loading) return <main className="shell auth-page"><p className="auth-loading">Verificando acceso…</p></main>;
  if (!auth.authenticated) return <AuthScreen theme={theme} onToggleTheme={toggleTheme} configured={auth.configured || Boolean(auth.error)} error={loginError || auth.error} username={loginUsername} setUsername={setLoginUsername} password={loginPassword} setPassword={setLoginPassword} busy={loginBusy} onSubmit={submitLogin} />;

  async function run(layout) {
    const format = formats[layout.id] || 'txt';
    setBusy((current) => ({ ...current, [layout.id]: true }));
    setStatus((current) => ({ ...current, [layout.id]: { type: 'loading', message: 'Ejecutando consulta…' } }));
    try {
      const result = await requestExport(`/api/run/${layout.id}`, { qna, fileName: fileNames[layout.id], format });
      if (result.correction) {
        setSp5Editor({ session: Date.now(), origin: 'single', url: `/api/run/${layout.id}`, payload: { qna, fileName: fileNames[layout.id], format }, layoutId: layout.id, text: result.correction.sp5Text, message: result.correction.error });
        setSp5EditorError('');
        return;
      }
      const defaultName = `${layout.id}_${qna}`;
      const chosenName = (fileNames[layout.id] || defaultName).trim().replace(/\.(txt|zip)$/i, '') || defaultName;
      await downloadResponse(result.response, `${chosenName}.${format}`);
      const count = result.response.headers.get('X-Row-Count');
      setStatus((current) => ({ ...current, [layout.id]: { type: 'success', message: `${count ?? '—'} registros · ${format.toUpperCase()} generado` } }));
    } catch (error) {
      setStatus((current) => ({ ...current, [layout.id]: { type: 'error', message: error.message } }));
    } finally {
      setBusy((current) => ({ ...current, [layout.id]: false }));
    }
  }

  async function runAll() {
    setBusy(Object.fromEntries(layouts.map(({ id }) => [id, true])));
    setStatus(Object.fromEntries(layouts.map(({ id }) => [id, { type: 'loading', message: 'Ejecutando consulta…' }])));
    try {
      const result = await requestExport('/api/run-all', { qna, bundleName, fileNames });
      if (result.correction) {
        setSp5Editor({ session: Date.now(), origin: 'all', url: '/api/run-all', payload: { qna, bundleName, fileNames }, text: result.correction.sp5Text, message: result.correction.error });
        setSp5EditorError('');
        return;
      }
      const chosenBundle = (bundleName || `SIGED_QNA_${qna}`).trim().replace(/\.(txt|zip)$/i, '');
      await downloadResponse(result.response, `${chosenBundle}.zip`);
      const counts = (result.response.headers.get('X-Layout-Counts') || '').split(',');
      setStatus(Object.fromEntries(layouts.map((layout, index) => [layout.id, {
        type: 'success', message: layout.id === 'SP4' && counts[index] === '0'
          ? '0 registros · omitido del ZIP'
          : `${counts[index] || '—'} registros · incluido en el ZIP`,
      }])));
    } catch (error) {
      setStatus(Object.fromEntries(layouts.map(({ id }) => [id, { type: 'error', message: error.message }])));
    } finally {
      setBusy({});
    }
  }

  async function saveSp5Corrections() {
    if (!sp5Editor) return;
    if (!sp5Editor.text.trim()) {
      setSp5EditorError('El TXT de SP5 no puede quedar vacío.');
      return;
    }
    const unresolved = unresolvedSp5Fields(sp5Editor.text);
    if (unresolved.length) {
      setSp5EditorError(`Quedan ${unresolved.length} campos NULL o vacíos. Corrige el siguiente seleccionado para continuar.`);
      const position = unresolved[0];
      if (position && sp5EditorRef.current) {
        sp5EditorRef.current.focus();
        sp5EditorRef.current.setSelectionRange(position.start, position.end);
      }
      return;
    }

    setSp5EditorBusy(true);
    setSp5EditorError('');
    try {
      const result = await requestExport(sp5Editor.url, { ...sp5Editor.payload, sp5Override: sp5Editor.text });
      if (result.correction) {
        setSp5Editor((current) => ({ ...current, session: Date.now(), text: result.correction.sp5Text, message: result.correction.error }));
        setSp5EditorError(result.correction.error);
        return;
      }
      if (sp5Editor.origin === 'all') {
        const chosenBundle = (sp5Editor.payload.bundleName || `SIGED_QNA_${sp5Editor.payload.qna}`).trim().replace(/\.(txt|zip)$/i, '');
        await downloadResponse(result.response, `${chosenBundle}.zip`);
        const counts = (result.response.headers.get('X-Layout-Counts') || '').split(',');
        setStatus(Object.fromEntries(layouts.map((layout, index) => [layout.id, {
          type: 'success', message: layout.id === 'SP4' && counts[index] === '0'
            ? '0 registros · omitido del ZIP'
            : `${counts[index] || '—'} registros · incluido en el ZIP`,
        }])));
      } else {
        const layoutId = sp5Editor.layoutId;
        const format = sp5Editor.payload.format;
        const defaultName = `${layoutId}_${sp5Editor.payload.qna}`;
        const chosenName = (sp5Editor.payload.fileName || defaultName).trim().replace(/\.(txt|zip)$/i, '') || defaultName;
        await downloadResponse(result.response, `${chosenName}.${format}`);
        const count = result.response.headers.get('X-Row-Count');
        setStatus((current) => ({ ...current, [layoutId]: { type: 'success', message: `${count ?? '—'} registros · ${format.toUpperCase()} generado con correcciones` } }));
      }
      setSp5Editor(null);
    } catch (error) {
      setSp5EditorError(error.message);
    } finally {
      setSp5EditorBusy(false);
    }
  }

  const allBusy = Object.values(busy).some(Boolean);

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#inicio" aria-label="Inicio SIGED">
        <img className="brand-logo" src="/siged-logo.png" alt="" /><span className="brand-name">Sistema Validador de Layouts Para el SIGED</span>
      </a>
      <div className="top-actions">
        <span className="top-label"><span className="live-dot" /> Herramienta de layouts</span>
        <ThemeButton theme={theme} onToggle={toggleTheme} />
        <button className="logout-button" type="button" onClick={logout}>Salir</button>
      </div>
    </header>

    <section className="intro" id="inicio">
      <div className="eyebrow"><span>PROCESO DE NÓMINA</span><i /> HASTA CINCO ARCHIVOS DE SALIDA</div>
      <h1>Creación de <em>layouts</em></h1>
      <p className="lead">Selecciona la quincena de proceso y genera los archivos de texto listos para integrar en SIGED.</p>
    </section>

    <section className="qna-panel" aria-label="Quincena de proceso">
      <div className="field-wrap">
        <label htmlFor="qna">QUINCENA DE PROCESO <span className="required">*</span></label>
        <div className={`input-box ${!qnaLoading && !valid && qnaError ? 'invalid' : ''}`}>
          <span className="calendar-icon">▦</span>
          <select id="qna" value={qna} disabled={qnaLoading || !qnas.length} onChange={(event) => setQna(event.target.value)} aria-describedby="qna-help">
            {!qnas.length && <option value="">{qnaLoading ? 'Consultando periodos…' : 'Sin periodos disponibles'}</option>}
            {qnas.map((period) => <option key={period} value={period}>{period}</option>)}
          </select>
          <button className="qna-refresh" type="button" onClick={() => setQnaRefresh((value) => value + 1)} disabled={qnaLoading} aria-label="Actualizar periodos" title="Volver a consultar las tablas disponibles">↻</button>
        </div>
        <p id="qna-help" className={qnaError ? 'help error-text' : 'help'}>{qnaError || (qnaLoading ? 'Leyendo tablas cc_ y ccd_ en sirhdb.dbo…' : qnas.length ? `${qnas.length} periodos encontrados en sirhdb.dbo.` : 'No se encontraron periodos con las tablas cc_ y ccd_ requeridas.')}</p>
      </div>
      <div className="bundle-actions">
        <div className="bundle-field">
          <label htmlFor="bundle-name">NOMBRE DE CARPETA Y ZIP</label>
          <input id="bundle-name" value={bundleName} onChange={(event) => setBundleName(event.target.value)} placeholder={`SIGED_QNA_${qna}`} />
        </div>
        <button className="primary-button" onClick={runAll} disabled={!valid || allBusy}>
          {allBusy ? <><span className="spinner" /> Generando…</> : <><span>↓</span> Generar los 5 TXT</>}
        </button>
      </div>
    </section>

    <div className="section-heading">
      <div><h2>Layouts disponibles</h2><p>Archivos independientes, sin encabezados y separados por |</p></div>
      <span className="count-pill">HASTA 05 ARCHIVOS</span>
    </div>

    <section className="layout-list">
      {layouts.map((layout, index) => {
        const current = status[layout.id];
        return <article className={`layout-card ${current?.type === 'error' ? 'has-error' : ''}`} key={layout.id}>
          <div className="number">0{index + 1}</div>
          <div className="layout-icon" aria-hidden="true">{layout.icon}</div>
          <div className="layout-info"><div className="layout-title"><h3>{layout.id}</h3><span>{layout.name}</span></div><p>{layout.desc}</p>
            {current && <div className={`result ${current.type}`} role="status">{current.type === 'success' && <span>✓</span>}{current.type === 'loading' && <span className="spinner small" />}{current.message}</div>}
          </div>
          <div className="layout-tools">
            <input className="file-name-input" aria-label={`Nombre de archivo para ${layout.id}`} value={fileNames[layout.id] || ''} onChange={(event) => setFileNames((current) => ({ ...current, [layout.id]: event.target.value }))} placeholder={`${layout.id}_${qna}`} />
            <select aria-label={`Formato de descarga para ${layout.id}`} value={formats[layout.id] || 'zip'} onChange={(event) => setFormats((current) => ({ ...current, [layout.id]: event.target.value }))}>
              <option value="txt">.TXT</option><option value="zip">.ZIP</option>
            </select>
            <button className="download-button" disabled={!valid || busy[layout.id]} onClick={() => run(layout)}>{busy[layout.id] ? 'Procesando…' : <>Generar <span>↗</span></>}</button>
          </div>
        </article>;
      })}
    </section>
    <footer><span>Sin encabezados y separado por |. El ZIP contiene los TXT con los nombres indicados.</span><span className="footer-code">SIGED <i>/</i> LAYOUTS</span></footer>

    {sp5Editor && <div className="sp5-editor-backdrop">
      <section className="sp5-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="sp5-editor-title">
        <div className="sp5-editor-heading">
          <div><span className="eyebrow"><span>REVISIÓN DE DATOS</span></span><h2 id="sp5-editor-title">Corregir archivo SP5</h2></div>
          <button className="logout-button" type="button" onClick={() => {
            if (sp5Editor.origin === 'all') {
              setStatus(Object.fromEntries(layouts.map(({ id }) => [id, { type: 'error', message: 'Generación cancelada para corregir los datos de SP5.' }])));
            } else {
              setStatus((current) => ({ ...current, [sp5Editor.layoutId]: { type: 'error', message: 'Descarga cancelada para corregir los datos de SP5.' } }));
            }
            setSp5Editor(null);
          }} disabled={sp5EditorBusy}>Cancelar</button>
        </div>
        <p className="sp5-editor-intro">{sp5Editor.message} El primer campo <code>NULL</code> está seleccionado. Corrige todos los valores en el TXT; al continuar se generará el archivo con tus cambios.</p>
        <textarea
          ref={sp5EditorRef}
          className="sp5-editor-textarea"
          value={sp5Editor.text}
          onChange={(event) => {
            setSp5Editor((current) => ({ ...current, text: event.target.value }));
            setSp5EditorError('');
          }}
          spellCheck="false"
          aria-label="Contenido del TXT SP5 para corregir"
        />
        {sp5EditorError && <p className="login-error sp5-editor-error" role="alert">{sp5EditorError}</p>}
        <div className="sp5-editor-actions">
          <span>{unresolvedSp5Fields(sp5Editor.text).length} campos NULL o vacíos pendientes</span>
          <button className="primary-button" type="button" onClick={saveSp5Corrections} disabled={sp5EditorBusy}>
            {sp5EditorBusy ? <><span className="spinner" /> Guardando…</> : sp5Editor.origin === 'all' ? 'Guardar cambios y generar ZIP' : 'Guardar cambios y descargar SP5'}
          </button>
        </div>
      </section>
    </div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
