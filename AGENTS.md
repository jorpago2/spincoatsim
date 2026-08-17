# SpinCoatSim

## Carbon y diseño

- Usa la versión instalada de `@carbon/react` y los componentes de Carbon cuando mejoren la interacción, pero no fuerces una composición poco clara.
- Consulta Storybook o la documentación oficial al introducir un componente, resolver una duda de comportamiento o sobrescribir estilos internos; no repitas la comparación para reutilizaciones evidentes.
- Evalúa la interfaz renderizada: jerarquía, proporción, legibilidad, accesibilidad, estados de interacción y comportamiento responsive importan tanto como compilar.

## Propiedad React, SSR, Worker y canvas

- React es el único propietario de la estructura, visibilidad, atributos ARIA, estado visual y eventos de los componentes que renderiza.
- La renderización inicial de `entry-server.tsx` debe ser compatible con la hidratación de `main.tsx`; después de hidratar, React sigue siendo el propietario del DOM interactivo. El prerender no debe introducir markup que diverja del árbol React.
- `gds.worker.ts` y `gdsClient.ts` procesan y transportan geometría GDS; no deben guardar referencias permanentes ni modificar directamente el DOM, el canvas o controles renderizados por React.
- Mantén la comunicación GDS en el cliente del worker y el estado de la aplicación. El canvas se actualiza desde el renderizado y los handlers React; no mezcles listeners imperativos con handlers React sobre el mismo control.
- Conserva unidades, límites de importación, advertencias de compatibilidad y alcance del modelo de spin coating. La interfaz no debe ocultar incertidumbres o limitaciones físicas.

## `scientific-ui`

- Corrige por defecto los problemas específicos dentro de este simulador.
- Modifica `scientific-ui` solo cuando la causa pertenezca realmente al componente compartido y la corrección deba propagarse a sus consumidores.
- Al actualizar el paquete vendorizado, cambia conjuntamente `package.json`, `pnpm-lock.yaml` y `vendor/jorpago2-scientific-ui-*.tgz`, y comprueba que el nuevo tarball quede rastreado por Git.

## Camino rápido por defecto

- Atiende una familia concreta de problemas por iteración y evita auditorías generales no solicitadas.
- Para un cambio localizado, inspecciona la implementación relevante, el estado afectado y una resolución representativa adicional.
- Entrega primero una iteración visible y comprobable; amplía el trabajo solo si el resultado o el riesgo lo justifican.
- No ejecutes suites completas, matrices extensas, benchmarks ni validaciones científicas para ajustes visuales localizados.
- Si el diagnóstico crece sin una causa clara, informa de lo comprobado antes de ampliar el alcance.

## Subagentes

- Usa subagentes `gpt-5.6-luna` con razonamiento `max` en paralelo cuando existan partes independientes y la delegación mejore claramente la velocidad, cobertura o calidad.
- Asigna a cada subagente un alcance concreto y sin solapamientos; el agente principal conserva la integración y la verificación final.
- Evita que varios subagentes editen simultáneamente el mismo archivo. Revisa siempre el diff y el estado integrado; no des por válida una comprobación declarada por un subagente sin verificar el resultado final.
- No uses subagentes para cambios pequeños, secuenciales o fuertemente acoplados cuando coordinar cueste más que resolverlos directamente.

## Verificación proporcional

- Para tareas visuales o de interacción, usa `$browser:control-in-app-browser` cuando esté disponible y comprueba la pantalla, la hidratación y el flujo afectado antes y después del cambio.
- Reutiliza `pnpm dev` y HMR durante la iteración; comprueba el flujo SSR/hidratación cuando el cambio afecte al markup inicial. No reconstruyas producción después de cada ajuste.
- Cambio visual localizado: navegador interno y la resolución afectada.
- Cambio React/TypeScript: `pnpm typecheck` y el flujo afectado.
- Cambio en GDS worker, canvas o modelo de geometría: `pnpm test` cuando el contrato de runtime pueda verse afectado.
- Cambio de lint o reglas estáticas: `pnpm lint`.
- Cambio de pruebas de navegador: `pnpm test:ui`.
- Cambio en SSR, prerender, bundle o integración final: `pnpm build`, que ejecuta typecheck, build de cliente, build SSR, prerender y comprobación de presupuesto.
- Usa `pnpm preview`, `pnpm storybook` o `pnpm build-storybook` solo cuando el flujo concreto lo requiera. Informa solo de verificaciones ejecutadas y mantén separadas la validez física del modelo y la calidad visual salvo que el cambio afecte a ambas.
