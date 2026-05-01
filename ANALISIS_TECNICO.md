# Análisis técnico integral (rendimiento, estabilidad y seguridad)

Fecha: 2026-05-01

## Resumen ejecutivo

Se identificaron problemas de **alto impacto** en 4 áreas:

1. **Seguridad (inyección de comandos / XSS)** por uso de `exec` con interpolación y `innerHTML` con contenido dinámico.
2. **Rendimiento** por renderizado basado en `innerHTML` y timers periódicos sin estrategia global de backpressure.
3. **Confiabilidad** por manejo incompleto de errores en procesos hijos y operaciones potencialmente destructivas sin validaciones.
4. **Operabilidad** por falta de pruebas automatizadas reales y escasa observabilidad estructurada.

---

## Hallazgos críticos

### 1) Riesgo de inyección de comandos (Command Injection)

- `systemController` construye comandos de shell con interpolación (`width`, `height`) y ejecuta con `exec`.  
  Riesgo: si esos valores no están validados por completo antes de llegar aquí, se podría ejecutar código arbitrario.  
  Ubicación: `backend/system/systemController.js`.
- `appController` usa fallback con `exec('start chrome --app="..."')`.  
  Riesgo: composición de comando shell innecesaria.
  Ubicación: `backend/launcher/appController.js`.
- Existe helper genérico `runExecCommand(command)` que facilita el patrón inseguro si se usa con entradas no sanitizadas.
  Ubicación: `backend/utils/utils.js`.

**Recomendación:** migrar a `spawn`/`execFile` con argumentos separados y validación estricta (`Number.isInteger`, rangos permitidos, allowlist).

### 2) Riesgo XSS en frontend por uso extensivo de `innerHTML`

- Utilidad `htmlToFragment` asigna directamente `tpl.innerHTML = html`.
  Ubicación: `frontend/src/utils/dom.js`.
- `NotificationToast.show(message)` inserta `message` con `innerHTML`.
  Ubicación: `frontend/src/ui/NotificationToast.js`.
- Múltiples módulos UI generan markup con `innerHTML` potencialmente mezclando datos dinámicos.

**Recomendación:**
- Usar `textContent` para texto variable.
- Encapsular saneamiento con una única función utilitaria (p.ej. escaping básico o librería dedicada).
- Establecer política: `innerHTML` solo con plantillas estáticas auditadas.

### 3) Operaciones destructivas sin frenos de seguridad

- Acciones como `shutdown /s /t 0` y `shutdown /r /t 0` se disparan directamente.
  Ubicación: `backend/system/systemController.js`.

**Riesgo:** ejecución accidental por evento erróneo o automatización defectuosa.

**Recomendación:** doble confirmación en backend (token de confirmación de corta vida + cooldown + auditoría).

---

## Hallazgos de rendimiento

### 4) Coste de render por `innerHTML` en actualizaciones frecuentes

- Varias pantallas reconstruyen bloques completos con `innerHTML`.
- Aunque existe batching con `requestAnimationFrame`, el patrón sigue creando/descartando nodos de forma masiva.
  Ubicación base de batching: `frontend/src/utils/dom.js`.

**Recomendación:**
- Migrar vistas calientes (mixer/discord/autoclicker) a actualización granular de nodos.
- Reutilizar nodos y aplicar diff mínimo.

### 5) Timers periódicos y polling continuo

- Hay múltiples `setInterval` en backend (limpieza IPs, audio poll, logger flush, performance monitor).

**Riesgo:** trabajo constante incluso en inactividad.

**Recomendación:**
- Aplicar intervalos adaptativos por carga/visibilidad.
- Unificar scheduler para tareas de mantenimiento.
- Medir p95/p99 de ciclo y aplicar backoff.

---

## Hallazgos de confiabilidad

### 6) Manejo de errores incompleto en procesos externos

- Hay ejecuciones de comandos sin revisar salida/errores en algunos caminos fallback.

**Recomendación:**
- Estandarizar wrapper robusto con timeout, kill tree, retry controlado y logging estructurado por `correlationId`.

### 7) Cobertura de tests prácticamente inexistente

- `npm test` está configurado para fallar por defecto y no hay suite real.
  Ubicación: `package.json`.

**Recomendación:**
- Añadir smoke tests de backend (arranque, health, endpoints críticos).
- Tests unitarios de utilidades puras y validadores.
- Test E2E mínimo de flujos críticos.

---

## Plan de corrección priorizado

### Fase 1 (Alta prioridad, 1-3 días)
1. Eliminar `exec` con interpolación en rutas críticas.
2. Corregir XSS directo en `NotificationToast` y cualquier sink de texto dinámico.
3. Añadir validación estricta de payloads en eventos Socket/API.
4. Activar tests de humo en CI local (`npm run check` + smoke API).

### Fase 2 (Media prioridad, 3-7 días)
1. Refactor de render hot paths (mixer/discord) con patch incremental de DOM.
2. Unificar scheduler de intervalos y backoff adaptativo.
3. Logging estructurado JSON con niveles y contexto de sesión.

### Fase 3 (Calidad continua)
1. Presupuesto de performance (CPU/memoria/latencia) y alertas.
2. Hardening de seguridad (headers, CSP, validación de origen socket, saneamiento centralizado).
3. Suite de regresión E2E para evitar reintroducción de fallos.

---

## Métricas objetivo recomendadas

- Tiempo de respuesta p95 API local: < 120 ms.
- Reconstrucciones completas de DOM en vistas activas: 0 por interacción normal.
- Errores no controlados (`uncaughtException` / `unhandledRejection`): 0 por día.
- Cobertura mínima inicial: 40% utilidades/controladores críticos.

---

## Conclusión

La aplicación tiene una base funcional sólida, pero actualmente no está en estado “perfecto” por riesgos claros de seguridad y mantenibilidad. La mayor mejora real vendrá de: **(1) hardening de ejecución de comandos**, **(2) eliminación de sinks XSS**, y **(3) pruebas automatizadas + observabilidad**.
