# SpinCoatSim

Browser-based GDS cross-section and spin-coating geometry simulator for low-cost microfabrication.

## Scope

- Imports GDSII locally and selects a horizontal section through any polygon layer.
- Builds uniform, patterned and etched material stacks.
- Estimates dry film thickness from a measured power-law RPM calibration.
- Applies annealing shrinkage and an area-conserving planarization model.
- Exports the section as PNG and the complete model as JSON.

The planarization control is a geometric interpolation, not CFD. It deliberately omits solvent transport, edge bead, dewetting, capillary instabilities and sol-gel reaction kinetics.

## Run locally

Requires Node.js 22.13 or later and pnpm.

```bash
pnpm install
pnpm dev
pnpm test
```
