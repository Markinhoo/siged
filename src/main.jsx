import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const layouts = [
  { id: 'SP1', name: 'ANL_CATEGORIAS', desc: 'Catálogo de categorías', icon: '▦' },
  { id: 'SP2', name: 'ANL_PLAZA', desc: 'Plazas vigentes y centros de trabajo', icon: '▤' },
  { id: 'SP3', name: 'MOV_PERSONAL', desc: 'Movimientos de personal', icon: '⇄' },
  { id: 'SP4', name: 'MOV_PLAZA', desc: 'Movimientos de plaza', icon: '⌕' },
  { id: 'SP5', name: 'PAGOS_NÓMINA', desc: 'Pagos de nómina', icon: '$' },
];

function App() {
  const [qna, setQna] = useState('202616');
  const [qnas, setQnas] = useState([]);
  const [qnaLoading, setQnaLoading] = useState(true);
  const [qnaError, setQnaError] = useState('');
  const [qnaRefresh, setQnaRefresh] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('siged-theme') || 'light');
  const [fileNames, setFileNames] = useState({});
  const [formats, setFormats] = useState({});
  const [bundleName, setBundleName] = useState('');
  const [busy, setBusy] = useState({});
  const [status, setStatus] = useState({});
  const valid = qnas.includes(qna);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('siged-theme', theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
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
        setQna((current) => available.includes(current) ? current : (available[0] || ''));
      })
      .catch((error) => {
        if (!active) return;
        setQnas([]);
        setQna('');
        setQnaError(error.message);
      })
      .finally(() => { if (active) setQnaLoading(false); });
    return () => { active = false; };
  }, [qnaRefresh]);

  async function run(layout) {
    const format = formats[layout.id] || 'txt';
    setBusy((current) => ({ ...current, [layout.id]: true }));
    setStatus((current) => ({ ...current, [layout.id]: { type: 'loading', message: 'Ejecutando consulta…' } }));
    try {
      const response = await fetch(`/api/run/${layout.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qna, fileName: fileNames[layout.id], format }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Error HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const defaultName = `${layout.id}_${qna}`;
      const chosenName = (fileNames[layout.id] || defaultName).trim().replace(/\.(txt|zip)$/i, '') || defaultName;
      anchor.download = `${chosenName}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const count = response.headers.get('X-Row-Count');
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
      const response = await fetch('/api/run-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qna, bundleName, fileNames }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Error HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const chosenBundle = (bundleName || `SIGED_QNA_${qna}`).trim().replace(/\.(txt|zip)$/i, '');
      anchor.download = `${chosenBundle}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const counts = (response.headers.get('X-Layout-Counts') || '').split(',');
      setStatus(Object.fromEntries(layouts.map((layout, index) => [layout.id, {
        type: 'success', message: `${counts[index] || '—'} registros · incluido en el ZIP`,
      }])));
    } catch (error) {
      setStatus(Object.fromEntries(layouts.map(({ id }) => [id, { type: 'error', message: error.message }])));
    } finally {
      setBusy({});
    }
  }

  const allBusy = Object.values(busy).some(Boolean);

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#inicio" aria-label="Inicio SIGED">
        <span className="brand-mark">S</span><span className="brand-name">SIGED<span className="brand-sub">· EXPORTADOR</span></span>
      </a>
      <div className="top-actions">
        <span className="top-label"><span className="live-dot" /> Herramienta de layouts</span>
        <button className="theme-toggle" type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'} title={theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}>
          <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
          <span>{theme === 'light' ? 'Oscuro' : 'Claro'}</span>
        </button>
      </div>
    </header>

    <section className="intro" id="inicio">
      <div className="eyebrow"><span>PROCESO DE NÓMINA</span><i /> CINCO ARCHIVOS DE SALIDA</div>
      <h1>Exportador de <em>layouts</em></h1>
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
      <span className="count-pill">05 ARCHIVOS</span>
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
            <select aria-label={`Formato de descarga para ${layout.id}`} value={formats[layout.id] || 'txt'} onChange={(event) => setFormats((current) => ({ ...current, [layout.id]: event.target.value }))}>
              <option value="txt">.TXT</option><option value="zip">.ZIP</option>
            </select>
            <button className="download-button" disabled={!valid || busy[layout.id]} onClick={() => run(layout)}>{busy[layout.id] ? 'Procesando…' : <>Generar <span>↗</span></>}</button>
          </div>
        </article>;
      })}
    </section>
    <footer><span>Sin encabezados y separado por |. El ZIP contiene los TXT con los nombres indicados.</span><span className="footer-code">SIGED <i>/</i> LAYOUTS</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
