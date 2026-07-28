# SpinCoatSim

Browser-based GDS cross-section and spin-coating geometry simulator for low-cost microfabrication.

Public web: https://jorpago2.github.io/spincoatsim/

## Scope

- Imports GDSII locally and selects a horizontal section through any polygon layer.
- Builds uniform, patterned and etched material stacks.
- Estimates dry film thickness from a measured power-law RPM calibration.
- Applies annealing shrinkage and finite-range, area-conserving lateral leveling.
- Reports local thickness, degree of planarization (DOP) and thickness non-uniformity.
- Exports the section as PNG and the complete model as JSON.

The leveling model is a Gaussian geometric surrogate, not CFD. Its lateral length must be fitted to measured profiles; it deliberately omits centrifugal flow, solvent transport, edge bead, dewetting, capillary instabilities and sol-gel reaction kinetics.

## Run locally

Requires Node.js 22.13 or later and pnpm.

```bash
pnpm install
pnpm dev
pnpm test
```

Every push to `main` is published automatically with GitHub Pages.
