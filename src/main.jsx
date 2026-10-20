import React, { useState } from 'react';
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
  const [fileNames, setFileNames] = useState({});
  const [formats, setFormats] = useState({});
  const [bundleName, setBundleName] = useState('');
  const [busy, setBusy] = useState({});
  const [status, setStatus] = useState({});
  const valid = /^\d{4}(0[1-9]|1[0-9]|2[0-4]|99)$/.test(qna);

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
      <span className="top-label"><span className="live-dot" /> Herramienta de layouts</span>
    </header>

    <section className="intro" id="inicio">
      <div className="eyebrow"><span>PROCESO DE NÓMINA</span><i /> CINCO ARCHIVOS DE SALIDA</div>
      <h1>Exportador de <em>layouts</em></h1>
      <p className="lead">Selecciona la quincena de proceso y genera los archivos de texto listos para integrar en SIGED.</p>
    </section>

    <section className="qna-panel" aria-label="Quincena de proceso">
      <div className="field-wrap">
        <label htmlFor="qna">QUINCENA DE PROCESO <span className="required">*</span></label>
        <div className={`input-box ${qna && !valid ? 'invalid' : ''}`}>
          <span className="calendar-icon">▦</span>
          <input id="qna" inputMode="numeric" maxLength={6} value={qna} onChange={(event) => setQna(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-describedby="qna-help" />
          <span className="format-tag">AAAAQQ</span>
        </div>
        <p id="qna-help" className={qna && !valid ? 'help error-text' : 'help'}>{qna && !valid ? 'Usa el formato AAAAQQ, por ejemplo 202616.' : 'Ejemplo: 202616 corresponde al año 2026, quincena 16.'}</p>
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
