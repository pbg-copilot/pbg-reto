#!/usr/bin/env bash
# Genera archivos para probar la política de adjuntos (spec 006) en tmp/adjuntos-prueba/.
# Son inofensivos: imitan la "firma" de archivos peligrosos, pero no ejecutan nada.
# Uso: bash scripts/adjuntos-de-prueba.sh
set -euo pipefail
dir="$(dirname "$0")/../tmp/adjuntos-prueba"
mkdir -p "$dir" && cd "$dir"

# Válidos: se aceptan.
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==' | base64 -d > 01-captura-valida.png
printf '%%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%%%EOF\n' > 02-informe-valido.pdf
printf 'ERROR 500 al exportar el reporte\nusuario: agente de ejemplo\n' > 03-registro-valido.log

# Disfrazados: la extensión miente; el servidor mira el contenido real (magic bytes) → 415.
{ printf 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00'; head -c 512 /dev/zero; } > 04-ejecutable-disfrazado.png
printf '<!doctype html><script>alert("xss")</script>\n' > 05-html-disfrazado.png
printf 'texto\x00con\x00bytes\x00nulos\n' > 06-binario-como-texto.txt

# No admitidos por tipo o tamaño: el navegador los frena; con curl, el servidor da 415 o 413.
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>\n' > 07-imagen-con-script.svg
head -c $((11 * 1024 * 1024)) /dev/zero > 08-muy-grande.pdf

# Nombre con HTML: se acepta (es un PNG real) y el nombre se muestra como texto, sin ejecutarse.
cp 01-captura-valida.png '09-"><img src=x onerror=alert(1)>.png'

ls -la
