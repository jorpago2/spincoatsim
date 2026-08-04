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

Requires Node.js 24 or later and pnpm 11.

```bash
pnpm install
pnpm dev
pnpm test
```

The application uses React, TypeScript and Vite and publishes the prerendered
static bundle from `dist/`.

Every push to `main` is published automatically with GitHub Pages.

## Citation

If you use this software in a scientific publication, please cite the exact version used. Citation metadata are provided in [`CITATION.cff`](CITATION.cff); GitHub's **Cite this repository** menu exports them in BibTeX and APA formats.
