# Plugin SDK & API Version Migration Guide

## API version actual
- `apiVersion: 1`

## Recomendación para nuevos plugins
1. Definir plugin usando `sdk/plugin-sdk.js`:
   - `definePlugin(...)`
   - `defineManifest(...)`
2. Declarar `integrity.sha256` en `manifest.json`.
3. Ejecutar `npm run plugin:validate`.

## Estrategia de upgrade futura (`apiVersion`)
- Mantener compatibilidad N-1 en `PluginManager`.
- Añadir adaptadores por versión cuando cambie contrato de hooks.
- Actualizar este documento y `tools/create-plugin.js` en cada bump de versión.
