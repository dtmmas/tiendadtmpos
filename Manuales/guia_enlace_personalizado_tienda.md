# Guía de enlace y dominio personalizado para la tienda

## Objetivo

Separar claramente la URL pública de la tienda online de la URL del sistema administrativo para evitar accesos equivocados al panel interno.

La tienda pública ahora soporta dos formas de acceso:

1. Ruta pública por alias:

`https://dominio-principal.com/s/{alias}`

2. Dominio personalizado de tienda:

`https://dominio-de-la-tienda.com`

Ejemplos:

- `https://dominio-principal.com/s/tiendadtm`
- `https://dtmtiendaonline.com`
- `https://tienda.cliente.com`

## Cómo configurarlo desde administración

1. Ingresar a `Configuración web`.
2. Abrir la sección `Enlace público de la tienda`.
3. Escribir el alias deseado en `Alias del enlace público`.
4. Si la tienda tendrá dominio propio, escribirlo en `Dominio personalizado`.
5. Revisar la `Vista previa del enlace`.
6. Revisar el `Estado del dominio`.
7. Guardar los cambios.
8. Usar el botón `Ver tienda pública` para abrir la URL final.

## Reglas del alias

- Solo se permiten letras, números y guiones medios.
- El sistema normaliza mayúsculas, espacios y acentos.
- El alias debe tener entre 3 y 60 caracteres.
- No puede entrar en conflicto con rutas reservadas del sistema.

## Reglas del dominio personalizado

- Debe ser diferente al dominio principal del sistema.
- Puede ser un dominio o subdominio, por ejemplo `tienda.midominio.com`.
- En desarrollo se permite usar `localhost:5173` o una IP local.
- El sistema valida formato y verifica si detecta registros DNS.
- Si el DNS todavía no apunta al servidor, la configuración puede guardarse, pero la publicación no quedará operativa hasta completar el apuntamiento.

## Comportamiento de la navegación

- La tienda pública principal abre en `/s/{alias}`.
- Si hay un dominio personalizado configurado y el usuario entra por ese dominio, la tienda abre desde la raíz `/`.
- El catálogo abre en `/s/{alias}/catalogo`.
- El carrito abre en `/s/{alias}/carrito`.
- El checkout abre en `/s/{alias}/checkout`.
- El seguimiento de pedidos abre en `/s/{alias}/pedido/{codigo}`.
- En dominio personalizado esas rutas equivalentes pasan a ser `/catalogo`, `/carrito`, `/checkout` y `/pedido/{codigo}`.
- Los enlaces antiguos `/tienda` y similares redirigen automáticamente a la nueva URL pública.
- Cuando existe dominio personalizado, los accesos públicos heredados pueden redirigir al dominio de la tienda.

## Pasos de publicación en producción

1. Crear el dominio o subdominio en el proveedor DNS.
2. Apuntar el registro `A` al IP del VPS.
3. Configurar Nginx o el proxy inverso para servir ese dominio desde el proyecto.
4. Emitir el certificado SSL.
5. Guardar el dominio en `Configuración web`.
6. Verificar la tienda en:
   - `/`
   - `/catalogo`
   - `/carrito`
   - `/checkout`
   - `/pedido/{codigo}`

## Pasos de desarrollo local

1. Definir un dominio local como `localhost:5173` en la configuración de tienda.
2. Levantar la app web en ese puerto.
3. Verificar que la raíz `/` cargue la tienda.
4. Verificar que `/login` y rutas administrativas no queden expuestas en el dominio configurado de tienda.

## Recomendaciones operativas

- Elegir un alias corto, fácil de recordar y alineado con la marca.
- Elegir un dominio exclusivo para la tienda y conservar el alias como respaldo.
- Compartir siempre la URL pública generada y no la URL del sistema administrativo.
- Si se cambia el alias, actualizar botones, banners, WhatsApp Business, Facebook e Instagram.
- Si se cambia el dominio, actualizar DNS, SSL, enlaces comerciales y accesos directos.

## Nota para desarrollo

- El alias público se guarda en `store_settings.public_slug`.
- El dominio personalizado se guarda en `store_settings.custom_domain`.
- El backend valida conflictos y formato antes de guardar.
- El frontend detecta automáticamente el hostname actual y decide si debe cargar la tienda desde `/` o desde `/s/{alias}`.
- Las rutas públicas viven bajo el prefijo fijo `/s/`.
- Las rutas heredadas `/tienda...` siguen existiendo solo como redirección de compatibilidad.
