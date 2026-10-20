# Exportador de layouts SIGED

Aplicación React con un servidor Express que ejecuta los cinco SELECT del archivo `queries.txt` contra SQL Server. Cada layout se genera sin encabezado y con columnas separadas por `|`. Puedes elegir un nombre por archivo y descargarlo como TXT o como ZIP que contiene ese TXT. Al usar “Generar los 5 TXT”, se descarga un ZIP único con el nombre de carpeta elegido y los cinco TXT con sus nombres personalizados.

## Requisitos

- Node.js 20 o posterior.
- Acceso de red desde el equipo donde corre Node.js hacia el SQL Server.
- Una cuenta SQL Server con permisos de lectura para las tablas consultadas.

## Configuración

1. Copia `.env.example` como `.env`.
2. Completa `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER` y `DB_PASSWORD` con los datos de la conexión existente. No pongas estas credenciales en React ni las compartas en el navegador.
3. Ajusta `DB_ENCRYPT` y `DB_TRUST_SERVER_CERTIFICATE` a la configuración de tu servidor.
4. Instala dependencias y arranca la aplicación:

   ```sh
   npm install
   npm run dev
   ```

   Abre la dirección local que Vite muestra en la terminal. Para usarla en una red, ejecuta el servidor en un equipo al que los usuarios puedan acceder y asegúrate de que ese equipo tenga acceso a SQL Server.

Para publicar una compilación, ejecuta `npm run build` y después `npm start` con `NODE_ENV=production` y el mismo `.env` disponible en el servidor.

## QNA y layouts

La QNA se captura en formato `AAAAQQ` (por ejemplo `202616`). Se aplica al parámetro de proceso de SP2, SP3 y SP4, y a los nombres de tablas `cc_YYYYQQ` y `ccd_YYYYQQ` del SP5. En SP1 se conserva `QNA_FIN>=202601`; en SP2 también se conserva `a.qna_fin >= 202401`, como indica el SQL original. La app permite generar un layout o los cinco.

Los valores nulos salen vacíos. Los pipes o saltos de línea que formen parte de un valor se sustituyen por espacios para preservar una fila por registro y el delimitador `|`. Verifica este comportamiento con quien consuma el layout si esas cadenas pudieran ser datos válidos.
