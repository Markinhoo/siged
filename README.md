# Exportador de layouts SIGED

Aplicación React con un servidor Express que ejecuta los cinco SELECT del archivo `queries.txt` contra SQL Server. El login protege las rutas de consulta y los resultados. Cada layout se genera sin encabezado y con columnas separadas por `|`. Puedes elegir un nombre por archivo y descargarlo como TXT o como ZIP que contiene ese TXT. Al usar “Generar los 5 TXT”, se descarga un ZIP único con el nombre de carpeta elegido y los cinco TXT con sus nombres personalizados.

## Requisitos

- Node.js 20 o posterior.
- Acceso de red desde el equipo donde corre Node.js hacia el SQL Server.
- Una cuenta SQL Server con permisos de lectura para las tablas consultadas.

## Configuración

1. Copia `.env.example` como `.env`.
2. Completa `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER` y `DB_PASSWORD` con los datos de la conexión existente. No pongas estas credenciales en React ni las compartas en el navegador.
3. Configura `APP_USERNAME` y `APP_PASSWORD`; la contraseña debe tener al menos 12 caracteres. El login se protege con una cookie HTTP-only y la sesión dura 8 horas. No uses la contraseña de SQL Server como contraseña del sitio.
4. Ajusta `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE` y `SESSION_SECURE_COOKIE`. Para publicar el sitio en una red, usa HTTPS y establece `SESSION_SECURE_COOKIE=true`.
5. Instala dependencias y arranca la aplicación:

   ```sh
   npm install
   npm run dev
   ```

   Abre la dirección local que Vite muestra en la terminal. La app escucha en localhost por defecto. Para acceso desde otros equipos, publícala detrás de un proxy HTTPS y configura `HOST` para el servidor; no la expongas directamente por HTTP en una red.

   En desarrollo, el supervisor reinicia el servidor si el proceso termina inesperadamente y al cambiar el SQL, el código del servidor o `.env`. Cerrar la pestaña del navegador no detiene el servidor; usa `Ctrl+C` en la terminal para detener toda la aplicación.

Para publicar una compilación, ejecuta `npm run build` y después `npm start` con `NODE_ENV=production` y el mismo `.env` disponible en el servidor.

## QNA y layouts

El selector de QNA se llena consultando en `sirhdb.dbo` los sufijos disponibles en tablas `cc_YYYYQQ` que también tengan su tabla `ccd_YYYYQQ` correspondiente. La selección se vuelve a validar en el servidor antes de ejecutar cualquier layout. En SP2, SP3 y SP4 se usa como quincena de proceso; en SP5 forma los nombres de tablas `cc_YYYYQQ` y `ccd_YYYYQQ`. En SP1 se conserva `QNA_FIN>=202601`; en SP2 también se conserva `a.qna_fin >= 202401`, como indica el SQL original. La app permite generar un layout o los cinco.

Los valores nulos salen vacíos. Los pipes o saltos de línea que formen parte de un valor se sustituyen por espacios para preservar una fila por registro y el delimitador `|`. Verifica este comportamiento con quien consuma el layout si esas cadenas pudieran ser datos válidos.
