---
name: Graphite & Pulp
colors:
  surface: '#fdf8f8'
  surface-dim: '#ddd9d8'
  surface-bright: '#fdf8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3f2'
  surface-container: '#f1edec'
  surface-container-high: '#ebe7e6'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#444748'
  inverse-surface: '#313030'
  inverse-on-surface: '#f4f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#5d5f5b'
  on-secondary: '#ffffff'
  secondary-container: '#e2e3de'
  on-secondary-container: '#636561'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1c18'
  on-tertiary-container: '#83847f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474746'
  secondary-fixed: '#e2e3de'
  secondary-fixed-dim: '#c6c7c2'
  on-secondary-fixed: '#1a1c19'
  on-secondary-fixed-variant: '#454744'
  tertiary-fixed: '#e3e3dd'
  tertiary-fixed-dim: '#c7c7c1'
  on-tertiary-fixed: '#1a1c18'
  on-tertiary-fixed-variant: '#464743'
  background: '#fdf8f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
typography:
  headline-lg:
    fontFamily: Bricolage Grotesque
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Bricolage Grotesque
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.1'
  headline-md:
    fontFamily: Bricolage Grotesque
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Karla
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Karla
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin: 32px
  safe-area: 16px
---

## Brand & Style

The design system is rooted in the tactile, human experience of sketching on physical media. It targets creative professionals, thinkers, and journals who value the "imperfect" and the "handmade" over digital sterility.

The visual style is **Artisanal/Tactile Minimalism**. It mimics a high-quality sketchbook with off-white, grain-textured paper. Every interface element is treated as an intentional ink or pencil stroke, characterized by slight line-weight variations, organic imperfections, and a lack of perfect geometric precision. The UI should evoke a sense of focus, intimacy, and raw creativity.

## Colors

The palette is strictly limited to traditional drafting materials.

- **Primary (Ink Black):** Used for all structural strokes, icons, and primary text. It should feel like high-pigment India ink.
- **Secondary (Pulp):** The base background color. An off-white, warm-toned paper hue that reduces eye strain.
- **Tertiary (Graphite):** A softer gray for secondary information, hints, and disabled states, mimicking light pencil sketches.
- **Accent (Highlighter):** A vibrant, semi-transparent yellow used sparingly for call-to-actions, selections, and emphasis. It should look like a quick felt-tip marker stroke.

## Typography

Typography balances the "quirky" nature of hand-drawing with professional legibility.

- **Headlines:** Use **Bricolage Grotesque**. Its expressive, slightly irregular letterforms mimic the character of manual lettering while maintaining a bold, editorial presence.
- **Body:** Use **Karla**. Its grotesque, slightly idiosyncratic spacing maintains the "imperfect" brand voice while ensuring long-form readability.
- **System/Labels:** Use **JetBrains Mono**. This provides a subtle "technical drawing" or "architectural notation" feel for metadata and small labels.

All text should be rendered with a slight "ink-bleed" effect where possible (softening edges) to avoid harsh digital aliasing.

## Layout & Spacing

The layout philosophy follows a **Loose Grid**. While alignment is necessary for usability, the spacing should feel breathable and non-rigid, much like a composition on a blank page.

- **Grid:** A standard 12-column system is used for desktop, but elements should occasionally "break" the grid by 4-8px to enhance the hand-drawn feel.
- **White Space:** Heavy use of margins is encouraged. Content should never feel cramped against the edges of the "paper."
- **Breakpoints:**
  - **Mobile (<600px):** Single column, 16px margins.
  - **Tablet (600-1024px):** 6 columns, 24px margins.
  - **Desktop (>1024px):** 12 columns, 32px margins.

## Elevation & Depth

This design system eschews digital shadows and blurs. Depth is communicated through **Physical Overlap** and **Line Weight**.

- **Tonal Layers:** No background elevation colors are used. Everything sits on the base paper texture.
- **Stroke Contrast:** Elements "closer" to the user have thicker, darker ink strokes (2px - 3px). Elements further away use thin graphite strokes (0.5px - 1px) or dotted lines.
- **Negative Space:** Depth is created by "cutting out" shapes or using the Accent color to lift an element from the background, mimicking a sticky note or a taped-on scrap of paper.

## Shapes

Shapes must never be mathematically perfect.

- **Strokes:** Use SVG filters or custom CSS `border-image` to create a "rough" edge effect. Lines should have slight variations in thickness.
- **Corners:** While the base roundedness is set to "Soft" (0.25rem), the actual execution should look like a hand-drawn corner—slightly overshot or slightly rounded by the natural movement of a pen.
- **Connectors:** Use arrows and lines that look like quick "doodles" to connect related pieces of information.

## Components

- **Buttons:** Styled as boxes with a 2px "ink" border. The hover state should apply a "Highlighter" (Accent) fill that looks like a marker stroke, slightly bleeding outside the border.
- **Cards:** Outlined with a thin graphite stroke. The card background remains the paper texture. Use a "dog-ear" fold effect in the corner for interactive cards.
- **Input Fields:** A single horizontal ink line (underline style) rather than a full box. Placeholder text should look like a faint pencil sketch.
- **Chips/Tags:** Styled to look like small pieces of masking tape or torn paper scraps, using irregular edges.
- **Checkboxes:** These should be literal "X" marks drawn inside hand-sketched squares.
- **Selection/Focus:** Instead of a blue glow, use a "scribble" or "underline" in the Accent color to indicate focus or active states.
- **Dividers:** Use rough, hand-drawn lines or a series of "dashes" that look like they were drawn with a physical ruler and a leaking pen.
