# ADR 0004 · Adjuntos en S3 privado, servidos por la API

- **Estado:** Aceptada (2026-10-20)
- **Contexto del PDF:** §09, "Guardar metadatos en PostgreSQL y binarios en
  almacenamiento de objetos. Los archivos no deben ser públicos: autorizar cada
  descarga o usar enlaces firmados de corta duración después de verificar permisos."
  §10, "Usar S3 o almacenamiento compatible; en desarrollo puede incluirse MinIO."

## Decisión

1. **Almacenamiento.** Los binarios van a un bucket S3 **privado**, con el SDK
   `@aws-sdk/client-s3`. Los metadatos van a `helpdesk.attachments`.
2. **Servidor S3 en desarrollo: RustFS (`rustfs/rustfs:1.0.3`), compatible con S3.**
   - El PDF sugiere MinIO, pero su imagen ya no se publica en Docker Hub (responde 404
     el 2026-10-20).
   - El código solo usa la API S3 estándar, así que funciona igual con MinIO, AWS S3
     o Cloudflare R2 cambiando `S3_ENDPOINT`.
3. **Descarga.** La API **verifica permisos en cada request** y hace streaming del
   archivo. No se usan URLs firmadas porque:
   - la CSP de la app (`img-src 'self'`) bloquearía las vistas previas servidas desde
     otro host;
   - el host S3 interno (`s3:9000`) no es accesible desde el navegador, y exponerlo
     agrega superficie;
   - verificar en cada request también cubre los permisos revocados después de
     generar un enlace.
4. **Bucket.** El backend lo crea al arrancar si no existe. Los buckets nuevos son
   privados: una petición anónima recibe 403.

## Consecuencias

- Las descargas pasan por la API. Para el volumen del reto es aceptable. A gran
  escala se podría pasar a URLs firmadas con un dominio público para S3 y ajustar la
  CSP.
- Los límites de tamaño y la lista blanca de tipos se aplican en el servidor (spec
  006).
