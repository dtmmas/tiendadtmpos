# Guía de enlace personalizado para la tienda

## Objetivo

Separar claramente la URL pública de la tienda online de la URL del sistema administrativo para evitar accesos equivocados al panel interno.

La tienda pública ahora usa la estructura:

`https://tu-dominio.com/s/{alias}`

Ejemplos:

- `https://tu-dominio.com/s/tiendadtm`
- `https://tu-dominio.com/s/catalogo-dtm`
- `https://tu-dominio.com/s/promos-tecnologia`

## Cómo configurarlo desde administración

1. Ingresar a `Configuración web`.
2. Abrir la sección `Enlace público de la tienda`.
3. Escribir el alias deseado en `Alias del enlace público`.
4. Revisar la `Vista previa del enlace`.
5. Guardar los cambios.
6. Usar el botón `Ver tienda pública` para abrir la URL final.

## Reglas del alias

- Solo se permiten letras, números y guiones medios.
- El sistema normaliza mayúsculas, espacios y acentos.
- El alias debe tener entre 3 y 60 caracteres.
- No puede entrar en conflicto con rutas reservadas del sistema.

## Comportamiento de la navegación

- La tienda pública principal abre en `/s/{alias}`.
- El catálogo abre en `/s/{alias}/catalogo`.
- El carrito abre en `/s/{alias}/carrito`.
- El checkout abre en `/s/{alias}/checkout`.
- El seguimiento de pedidos abre en `/s/{alias}/pedido/{codigo}`.
- Los enlaces antiguos `/tienda` y similares redirigen automáticamente a la nueva URL pública.

## Recomendaciones operativas

- Elegir un alias corto, fácil de recordar y alineado con la marca.
- Compartir siempre la URL pública generada y no la URL del sistema administrativo.
- Si se cambia el alias, actualizar botones, banners, WhatsApp Business, Facebook e Instagram.

## Nota para desarrollo

- El alias público se guarda en `store_settings.public_slug`.
- El backend valida conflictos y formato antes de guardar.
- Las rutas públicas viven bajo el prefijo fijo `/s/`.
- Las rutas heredadas `/tienda...` siguen existiendo solo como redirección de compatibilidad.
