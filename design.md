# Design — SpinCoatSim

SpinCoatSim follows the shared scientific-tool interface contract. The app stays
quiet around the cross-section: green-tinted neutral surfaces, a restrained
spin-coating orange accent, and information revealed in process order.

## Genre

Modern-minimal technical workbench.

## Macrostructure family

- App: **Workbench** — compact utility header, progressive configuration rail,
  and a dominant result surface.
- Mobile: mutually exclusive **Configure / Results** layers.
- Content routes, if added: **Long Document**.
- Marketing pages: not defined; this repository is a scientific tool.

## Theme

- Paper: `oklch(97.2% 0.008 155)`.
- Surface: `oklch(98.5% 0.006 155)`.
- Ink: `oklch(22% 0.025 205)`.
- Accent: `oklch(46% 0.145 38)`, reserved for coating, focus and primary actions.
- Scientific material colours retain physical meaning and are not decorative.

## Typography

- Display: Space Grotesk, 600–700, roman.
- Body: IBM Plex Sans, 400–600.
- Numeric labels: IBM Plex Mono, 500–600, tabular figures.
- Explanatory text is at least 14 px; compact labels are at least 12 px.

## Interaction

- Inputs and buttons share a 44 px base height and an 8 px radius.
- Focus appears instantly; hover and active states never change border width.
- Motion is limited to colour and one-pixel press feedback.
- Native disclosures reveal stack, coating and model detail on request.
- Reduced motion removes optional transitions.

## Responsive contract

- Below 60 rem: one workspace layer is visible at a time through Configure and
  Results controls.
- At 60 rem and above: configuration and result remain visible together.
- No page-level horizontal scroll at 320, 375, 414 or 768 px.

## Shared invariants

- Header, Dashboard link, skip link, surface hierarchy and focus treatment follow
  the suite contract in `jorpago2.github.io/docs/interface-contract.md`.
- The app opens idle and never loads or computes the example automatically.
- Units, validation, model warnings and local-processing status remain visible.

## Exports

The canonical CSS implementation is [`tokens.css`](tokens.css). Core mappings:

```css
@theme {
  --color-paper: oklch(97.2% 0.008 155);
  --color-ink: oklch(22% 0.025 205);
  --color-accent: oklch(46% 0.145 38);
  --font-display: "Space Grotesk", sans-serif;
  --font-body: "IBM Plex Sans", sans-serif;
  --spacing-md: 1.5rem;
  --radius-input: 0.5rem;
}
```

```json
{
  "color": {
    "paper": { "$value": "oklch(97.2% 0.008 155)", "$type": "color" },
    "ink": { "$value": "oklch(22% 0.025 205)", "$type": "color" },
    "accent": { "$value": "oklch(46% 0.145 38)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body": { "$value": "IBM Plex Sans", "$type": "fontFamily" }
  }
}
```

```css
:root {
  --background: 97.2% 0.008 155;
  --foreground: 22% 0.025 205;
  --primary: 46% 0.145 38;
  --primary-foreground: 98.5% 0.006 155;
  --border: 86% 0.018 175;
  --ring: 50% 0.16 38;
  --radius: 0.5rem;
}
```
