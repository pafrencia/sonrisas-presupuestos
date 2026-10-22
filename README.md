# Presupuestos · Sonrisas Perfectas

Aplicación web para armar e imprimir presupuestos odontológicos. Reemplaza la planilla de Google Sheets con las mismas funciones:

- Se escribe el código del tratamiento (por ejemplo `2` o `002`) y aparecen el detalle y los precios.
- Precio de lista (hasta 3 cuotas), efectivo, transferencia / QR / débito y 6 cuotas, con el valor de cada cuota.
- Buscador de tratamientos por palabra, con botón para agregarlo al presupuesto.
- Fecha automática, nombre del paciente, filas vacías que no se imprimen.
- Botón para imprimir o guardar en PDF solo el presupuesto, con logo y texto de validez.

Hay dos tipos de usuario:

| | Administrador | Usuario común |
|---|---|---|
| Armar e imprimir presupuestos | Sí | Sí |
| Cargar, editar y borrar tratamientos | Sí | No |
| Subir la lista completa desde Excel o CSV | Sí | No |
| Cambiar porcentajes y días de validez | Sí | No |
| Crear usuarios y cambiar contraseñas | Sí | No |

## Cómo se calculan los precios

Para cada tratamiento se guarda solo el precio en **efectivo**. El resto sale con los porcentajes configurados (las mismas fórmulas de la planilla):

- Lista = efectivo ÷ (1 − descuento efectivo) × (1 + recargo 3 cuotas)
- Transferencia / QR / débito = efectivo ÷ (1 − descuento efectivo) × (1 − descuento transferencia)
- 6 cuotas = efectivo ÷ (1 − descuento efectivo) × (1 + recargo 6 cuotas)

## Publicarla gratis en Cloudflare

1. Entrá a [dash.cloudflare.com](https://dash.cloudflare.com) (creá la cuenta si no tenés, es gratis).
2. **Crear la base de datos:** menú *Storage & Databases → D1 SQL Database → Create*. Nombre: `sonrisas-presupuestos`. No hace falta cargarle nada: la app crea las tablas y la lista de precios inicial sola.
3. **Crear la página:** menú *Workers & Pages → Create → Pages → Connect to Git*. Elegí este repositorio.
   - Framework preset: *None*
   - Build command: (vacío)
   - Build output directory: `public`
   - Tocá *Save and Deploy*.
4. **Conectar la base:** en el proyecto de Pages, *Settings → Bindings → Add → D1 database*. Variable name: `DB` y elegí la base `sonrisas-presupuestos`. Guardá.
5. Volvé a *Deployments* y en el último despliegue tocá *Retry deployment* (para que tome la base).
6. Abrí la dirección `https://<nombre>.pages.dev`. La primera vez te pide crear el **administrador**: elegí usuario y contraseña.
7. Desde *Administración → Usuarios* creá los usuarios comunes para el resto del equipo.

Cada vez que se suba un cambio al repositorio, Cloudflare publica la nueva versión sola. Los precios y usuarios quedan en la base, no se pierden.

## Subir la lista de precios desde Excel

En *Administración → Tratamientos y precios → Subir lista* se puede elegir un archivo `.xlsx` o `.csv` con estas columnas (la primera fila con los títulos):

| codigo | tratamiento | efectivo | categoria |
|---|---|---|---|
| 002 | Arreglo provisional | 32000 | General |

Lo más fácil es tocar *Descargar lista*, editarla en Excel y volver a subirla.

## Probarla en la computadora (opcional, para programadores)

```bash
npm install
npm run dev
```

y abrir http://localhost:8788.
