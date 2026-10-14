# Reporte de validacion Root Core

Fecha: 2026-10-13

## Alcance validado

- Creacion y migracion del usuario `root@local` al rol exclusivo `ROOT`.
- Aislamiento del modulo `Root Core` para roles `ROOT` y `SUPERUSUARIO`.
- Restricciones multicapa en frontend, rutas backend y endpoints API.
- Ocultamiento de roles y usuarios especiales en los modulos administrativos normales.
- Auditoria inmutable para cambios core.
- Compatibilidad del flujo `IMEI-SERIAL VARIANTE` con el control de tipos habilitados.

## Comandos ejecutados

```powershell
npm run build
node --test tests/root-core.integration.test.mjs
npm test
```

## Resultados

### Frontend

- `client`: compilacion exitosa con `vite build`.
- Estado: aprobado.

### Backend y seguridad Root Core

- `el usuario root existe y solo carga permisos del modulo core`: aprobado.
- `un administrador estandar no puede entrar por ruta directa al modulo root`: aprobado.
- `un token manipulado con rol root no supera la validacion multicapa del backend`: aprobado.
- `root puede cambiar flags core y cada cambio queda auditado`: aprobado.
- `root puede crear un superusuario granular y el sistema bloquea lo no autorizado`: aprobado.
- `roles y usuarios root quedan ocultos de las rutas administrativas normales y token invalido se rechaza`: aprobado.

### Suite completa backend

- Total pruebas: 20
- Exitosas: 20
- Fallidas: 0

## Evidencia funcional

- La API `GET /api/root-core/state` devuelve `403` para administradores normales autenticados.
- La API `GET /api/root-core/state` devuelve `403` para tokens manipulados que intentan elevar el rol en cliente.
- El usuario `root@local` autentica como `ROOT` y recibe solo permisos:
  - `root:access`
  - `root:audit:read`
  - `root:core:permissions`
  - `root:core:product-types`
  - `root:core:store`
- Los listados normales de `usuarios` y `roles` excluyen `ROOT` y `SUPERUSUARIO`.
- La auditoria root queda protegida contra `UPDATE` y `DELETE` mediante triggers en base de datos.

## Observaciones

- El esquema legacy tenia `roles.code` como `ENUM` y un root previo basado en `is_root`. Se migro automaticamente al modelo nuevo.
- Las pruebas de productos serializados ahora fuerzan el tipo `VARIANT_SERIALIZED` como habilitado para evitar falsos negativos por configuraciones residuales del sistema.
