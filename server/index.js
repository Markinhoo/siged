import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3002);
const host = process.env.HOST || '127.0.0.1';
const here = path.dirname(fileURLToPath(import.meta.url));
const queryText = await readFile(path.join(here, '..', 'queries.txt'), 'utf8');
const sections = [
  { id: 'SP1', title: 'ANL_CATEGORIAS', start: 'LAYOUT SP1', next: 'LAYOUT SP2' },
  { id: 'SP2', title: 'ANL_PLAZA', start: 'LAYOUT SP2', next: 'SP3 - MOV_PERSONAL' },
  { id: 'SP3', title: 'MOV_PERSONAL', start: 'SP3 - MOV_PERSONAL', next: 'LAYOUT SP4' },
  { id: 'SP4', title: 'MOV_PLAZA', start: 'LAYOUT SP4', next: 'LAYOUT SP5' },
  { id: 'SP5', title: 'PAGOS_NÓMINA', start: 'LAYOUT SP5', next: null },
];
const sessions = new Map();
const loginAttempts = new Map();
const sessionTtlMs = 8 * 60 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;
const cookieName = 'siged_session';

function sectionSql(section) {
  const start = queryText.indexOf(section.start);
  const end = section.next ? queryText.indexOf(section.next, start + section.start.length) : queryText.length;
  if (start < 0 || end < 0) throw new Error(`No se encontró la sección ${section.id} en queries.txt`);
  return queryText.slice(start, end).replace(/^[^\r\n]*\r?\n/, '').replace(/\r?\n\s*-{4,}[^\r\n]*$/s, '').trim();
}

const poolConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  ...(process.env.DB_DATABASE ? { database: process.env.DB_DATABASE } : {}),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 120000,
};

let poolPromise;
function getPool() {
  if (!poolConfig.server || !poolConfig.user || !poolConfig.password) {
    throw new Error('Falta configurar DB_SERVER, DB_USER y DB_PASSWORD en .env.');
  }
  poolPromise ??= new sql.ConnectionPool(poolConfig).connect().catch((error) => {
    poolPromise = undefined;
    throw error;
  });
  return poolPromise;
}

function authCredentials() {
  return { username: process.env.APP_USERNAME || '', password: process.env.APP_PASSWORD || '' };
}

function authIsConfigured() {
  const { username, password } = authCredentials();
  return Boolean(username && password.length >= 12);
}

function safeEqual(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(actual ?? ''));
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function sessionToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  return cookie ? cookie.slice(cookieName.length + 1) : '';
}

function setSessionCookie(res, token) {
  const secure = process.env.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.SESSION_SECURE_COOKIE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function currentSession(req) {
  const token = sessionToken(req);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireAuth(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  req.authSession = session;
  return next();
}

async function availableQnas() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT SUBSTRING(t.name, 4, 6) AS qna
    FROM sirhdb.sys.tables AS t
    INNER JOIN sirhdb.sys.schemas AS s ON s.schema_id = t.schema_id
    WHERE s.name = N'dbo'
      AND t.name LIKE N'cc[_][0-9][0-9][0-9][0-9][0-9][0-9]'
      AND TRY_CONVERT(int, SUBSTRING(t.name, 4, 6)) IS NOT NULL
      AND SUBSTRING(t.name, 8, 2) IN (N'99', N'01', N'02', N'03', N'04', N'05', N'06', N'07', N'08', N'09', N'10', N'11', N'12', N'13', N'14', N'15', N'16', N'17', N'18', N'19', N'20', N'21', N'22', N'23', N'24')
      AND EXISTS (
        SELECT 1
        FROM sirhdb.sys.tables AS d
        INNER JOIN sirhdb.sys.schemas AS ds ON ds.schema_id = d.schema_id
        WHERE ds.name = N'dbo'
          AND d.name = N'ccd_' + SUBSTRING(t.name, 4, 6)
      )
    ORDER BY TRY_CONVERT(int, SUBSTRING(t.name, 4, 6)) DESC
  `);
  return result.recordset.map((row) => String(row.qna).trim());
}

function prepareSql(section, qna) {
  let text = sectionSql(section);
  // QNA se valida como YYYYQQ antes de interpolarla en los layouts de proceso
  // y en los nombres cc_YYYYQQ. Los cortes fijos de SP1 y SP2 se conservan.
  text = text.replace(/202616/g, String(qna));
  return text;
}

function findNullLiteralIssues(rows) {
  const issues = [];
  rows.forEach((row, index) => {
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.trim().toUpperCase() === 'NULL') {
        issues.push({ row: index + 1, payroll: String(row.NUMERO_NOMINA ?? ''), field });
      }
    }
  });
  return issues;
}

function nullLiteralError(issues) {
  const examples = issues.slice(0, 30).map(({ row, payroll, field }) =>
    `fila ${row}${payroll ? ` (nómina ${payroll})` : ''}: ${field}`);
  const remainder = issues.length > examples.length ? ` y ${issues.length - examples.length} más` : '';
  return `SP5 no se generó: hay ${issues.length} campo(s) con el texto NULL. Corrige los datos de origen en SQL y vuelve a intentar. ${examples.join('; ')}${remainder}.`;
}

function safeBaseName(value, fallback) {
  const cleaned = String(value ?? '').trim()
    .replace(/\.(txt|zip)$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

function attachmentName(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function executeLayout(section, qna) {
  const pool = await getPool();
  const result = await pool.request().query(prepareSql(section, qna));
  const rows = result.recordsets?.[0] ?? result.recordset ?? [];
  const output = rows.map((row) => Object.values(row).map((value) => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[|\r\n]/g, ' ');
  }).join('|')).join('\r\n');
  return { output, rowCount: rows.length, rows };
}

function createZip(files) {
  // Genera un ZIP estándar sin dependencias adicionales (método "store").
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.output, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

app.use(cors());
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/session', (req, res) => {
  const session = currentSession(req);
  return res.json({ configured: authIsConfigured(), authenticated: Boolean(session), username: session?.username || '' });
});
app.post('/api/auth/login', (req, res) => {
  if (!authIsConfigured()) {
    return res.status(503).json({ error: 'Configura APP_USERNAME y APP_PASSWORD (mínimo 12 caracteres) en .env y reinicia la aplicación.' });
  }
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(address);
  if (attempt && now - attempt.startedAt < loginWindowMs && attempt.count >= maxLoginAttempts) {
    const seconds = Math.ceil((loginWindowMs - (now - attempt.startedAt)) / 1000);
    return res.status(429).json({ error: `Demasiados intentos. Vuelve a probar en ${seconds} segundos.` });
  }
  if (!attempt || now - attempt.startedAt >= loginWindowMs) loginAttempts.set(address, { startedAt: now, count: 0 });
  const credentials = authCredentials();
  const usernameMatches = safeEqual(credentials.username, req.body?.username);
  const passwordMatches = safeEqual(credentials.password, req.body?.password);
  if (!usernameMatches || !passwordMatches) {
    const current = loginAttempts.get(address);
    current.count += 1;
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  loginAttempts.delete(address);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + sessionTtlMs;
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
  sessions.set(token, { username: credentials.username, expiresAt });
  setSessionCookie(res, token);
  return res.json({ authenticated: true, username: credentials.username });
});
app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  return res.json({ authenticated: false });
});
app.use('/api', requireAuth);
app.get('/api/layouts', (_req, res) => res.json(sections.map(({ id, title }) => ({ id, title }))));
app.get('/api/qnas', async (_req, res) => {
  try {
    return res.json({ qnas: await availableQnas() });
  } catch (error) {
    console.error('Consulta de QNA disponibles:', error);
    return res.status(500).json({ error: error.message || 'No se pudieron consultar las QNA disponibles.' });
  }
});

app.post('/api/run-all', async (req, res) => {
  const qna = String(req.body?.qna ?? '');
  if (!/^\d{4}(0[1-9]|1[0-9]|2[0-4]|99)$/.test(qna)) {
    return res.status(400).json({ error: 'La QNA debe tener formato AAAAQQ, por ejemplo 202616.' });
  }
  const bundleName = safeBaseName(req.body?.bundleName, `SIGED_QNA_${qna}`);
  try {
    if (!(await availableQnas()).includes(qna)) {
      return res.status(409).json({ error: `No existe el periodo ${qna} con las tablas cc_${qna} y ccd_${qna} en sirhdb.dbo.` });
    }
    const results = [];
    const layoutCounts = [];
    for (const section of sections) {
      const { output, rowCount, rows } = await executeLayout(section, qna);
      layoutCounts.push(rowCount);
      if (section.id === 'SP5') {
        const issues = findNullLiteralIssues(rows);
        if (issues.length) return res.status(422).json({ error: nullLiteralError(issues) });
      }
      if (section.id === 'SP4' && rowCount === 0) {
        continue;
      }
      const fileName = safeBaseName(req.body?.fileNames?.[section.id], `${section.id}_${qna}`);
      results.push({ name: `${bundleName}/${fileName}.txt`, output, rowCount });
    }
    const zip = createZip(results);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentName(`${bundleName}.zip`),
      'X-Layout-Counts': layoutCounts.join(','),
    });
    return res.send(zip);
  } catch (error) {
    console.error('Generación de los cinco layouts:', error);
    return res.status(500).json({ error: error.message || 'Error al generar los cinco layouts.' });
  }
});

app.post('/api/run/:id', async (req, res) => {
  const section = sections.find((item) => item.id === req.params.id);
  const qna = String(req.body?.qna ?? '');
  if (!section) return res.status(404).json({ error: 'Layout no encontrado.' });
  if (!/^\d{6}$/.test(qna) || !/^\d{4}(0[1-9]|1[0-9]|2[0-4]|99)$/.test(qna)) {
    return res.status(400).json({ error: 'La QNA debe tener formato AAAAQQ, por ejemplo 202616.' });
  }
  const fileName = safeBaseName(req.body?.fileName, `${section.id}_${qna}`);
  const format = req.body?.format === 'zip' ? 'zip' : 'txt';
  try {
    if (!(await availableQnas()).includes(qna)) {
      return res.status(409).json({ error: `No existe el periodo ${qna} con las tablas cc_${qna} y ccd_${qna} en sirhdb.dbo.` });
    }
    const { output, rowCount, rows } = await executeLayout(section, qna);
    if (section.id === 'SP5') {
      const issues = findNullLiteralIssues(rows);
      if (issues.length) return res.status(422).json({ error: nullLiteralError(issues) });
    }
    if (format === 'zip') {
      const zip = createZip([{ name: `${fileName}.txt`, output }]);
      res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachmentName(`${fileName}.zip`), 'X-Row-Count': String(rowCount) });
      return res.send(zip);
    }
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': attachmentName(`${fileName}.txt`), 'X-Row-Count': String(rowCount) });
    return res.send(output);
  } catch (error) {
    console.error(`${section.id}:`, error);
    return res.status(500).json({ error: error.message || 'Error al ejecutar la consulta.' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(here, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(port, host, () => console.log(`Servidor SIGED disponible en http://${host}:${port}`));
server.on('error', (error) => {
  console.error(`No se pudo iniciar el servidor en ${host}:${port}: ${error.message}`);
  // Código reservado para que el supervisor no reinicie en un ciclo infinito.
  const exitCode = error.code === 'EADDRINUSE' ? 98 : 1;
  server.close(() => process.exit(exitCode));
});
