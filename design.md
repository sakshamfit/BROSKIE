---
name: BROSKIE
colors:
  surface: '#f5fbf4'
  surface-dim: '#d5dcd5'
  surface-bright: '#f5fbf4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff5ee'
  surface-container: '#e9efe9'
  surface-container-high: '#e4eae3'
  surface-container-highest: '#dee4de'
  on-surface: '#171d19'
  on-surface-variant: '#3d4a42'
  inverse-surface: '#2c322e'
  inverse-on-surface: '#ecf2ec'
  outline: '#6d7a71'
  outline-variant: '#bccac0'
  surface-tint: '#006c48'
  primary: '#006c48'
  on-primary: '#ffffff'
  primary-container: '#76ebb3'
  on-primary-container: '#006a46'
  inverse-primary: '#67dca5'
  secondary: '#006d2f'
  on-secondary: '#ffffff'
  secondary-container: '#5dfd8a'
  on-secondary-container: '#007232'
  tertiary: '#7c5724'
  on-tertiary: '#ffffff'
  tertiary-container: '#ffcc8e'
  on-tertiary-container: '#795522'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#84f9c0'
  primary-fixed-dim: '#67dca5'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005235'
  secondary-fixed: '#66ff8e'
  secondary-fixed-dim: '#3de273'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005322'
  tertiary-fixed: '#ffddb7'
  tertiary-fixed-dim: '#efbe81'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#61400e'
  background: '#f5fbf4'
  on-background: '#171d19'
  surface-variant: '#dee4de'
  clay-white: '#ffffff'
  clay-shadow-soft: '#e2e8f0'
  surface-bg: '#f8fafc'
  on-surface-text: '#1e293b'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md-mobile:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  unit: 8px
  gutter-md: 1.5rem
  margin-mobile: 1.25rem
  clay-padding: 1.5rem
---

## Brand & Style

The design system is a radical evolution of traditional messaging interfaces, shifting from corporate utility to a playful, tactile, and ultra-modern aesthetic. Built for the "BROSKIE" app, it centers on the **Claymorphism** movement—characterized by soft, 3D "inflated" surfaces that feel physically touchable.

The brand personality is approachable, friendly, and high-energy. It targets a digitally native audience that values expressive UI over rigid structure. By combining **Minimalism** with tactile depth, the design system removes visual noise (borders, dividers, heavy text) and replaces it with volume and shadow to define hierarchy. The emotional goal is to make digital communication feel as soft and engaging as physical interaction.

## Colors

The palette is anchored in a soft, pastel interpretation of "Communication Green."

- **Primary (#76EBB3):** A desaturated, airy mint used for high-volume clay elements like active chat bubbles and primary action surfaces.
- **Secondary (#25D366):** The legacy brand green, now reserved for accent moments, notification badges, and high-priority status indicators.
- **Neutral/Surface:** The "Clay-White" (#FFFFFF) serves as the primary material for cards and inputs. The background is a very light "Surface-BG" (#F8FAFC) to allow white clay elements to pop through their outer shadows.
- **Shadows:** Instead of black or grey, shadows use a "Clay-Shadow-Soft" (#E2E8F0) tint to maintain the clean, pastel aesthetic while providing the necessary 3D volume.

## Typography

This design system utilizes **Inter** with a specific focus on modern, spacious typesetting. To balance the heavy visual weight of claymorphic elements, typography must feel light and intentional.

- **Spacing:** Letter-spacing is increased across all body and label styles to enhance the "minimalist" breathing room.
- **Weights:** Headlines use bold and semi-bold weights to cut through the soft shadows of the UI.
- **Convention:** The `@username` convention is treated as a specialized label style, often paired with the Primary color to emphasize identity.
- **Scale:** Display sizes are significantly larger on desktop to act as anchor points, while mobile typography focuses on vertical efficiency and generous line heights for readability.

## Layout & Spacing

The layout philosophy is based on a **Fluid Grid** with an emphasis on "Safe Zones." Because claymorphic elements require extra space for their outer shadows to breathe without clipping, the spacing rhythm is more generous than standard flat designs.

- **The 8px Rhythm:** All spacing (padding, margins, gutters) follows an 8px base unit.
- **Clay Padding:** Elements like cards and buttons use a minimum of 24px (1.5rem) internal padding to ensure the "inflated" edges don't crowd the content.
- **No Dividers:** Horizontal rules and borders are strictly prohibited. Separation is achieved through 16px to 24px vertical gutters between elevated surfaces.
- **Mobile:** On mobile, margins are increased to 20px to prevent the 3D shadows from touching the screen edges.

## Elevation & Depth

Hierarchy is established through a **Dual-Shadow Technique** to create the signature Claymorphism look.

1.  **Outer Shadows:** Used to lift the element off the background. Use two layers: one soft, large-radius shadow for the ambient glow, and one smaller, slightly darker shadow to anchor the object.
2.  **Inner Shadows:** Crucial for the "inflated" look. Use a light inner shadow (Top-Left) for a highlight effect and a slightly darker, inset shadow (Bottom-Right) to simulate the curve of the clay.
3.  **Tonal Layers:**
    - **Level 0 (Background):** Soft gray (#F8FAFC).
    - **Level 1 (Cards/Bubbles):** White or Pastel Green with 3D inflation.
    - **Level 2 (Active States/FAB):** Deeper shadows and slightly more intense inner highlights to suggest the element is more "puffed up" than others.

## Shapes

The shape language is **Extreme Roundness**. Every interactive element should feel like a smooth, molded piece of clay.

- **Pill Geometry:** Buttons, input fields, and tags are strictly pill-shaped (`rounded-full`).
- **Cards & Bubbles:** Use the `rounded-xl` (24px) or higher setting. Even large containers should avoid sharp corners to maintain the soft-body physics of the design.
- **Avatars:** To maintain consistency with the rounded theme, avatars are always circular and feature a subtle inner shadow to look like they are "set into" the clay surface.

## Components

### Buttons
Primary buttons are pill-shaped, colored in the Primary Mint, and feature a white inner-top-left shadow to create a highlight. On "press," the outer shadow shrinks while the inner shadow deepens, simulating the squishing of physical clay.

### Clay Cards
Used for user profiles and settings blocks. These are white, `rounded-xl` containers with no borders. They rely entirely on a large, soft outer shadow (#E2E8F0) to define their boundaries against the light gray background.

### Chat Bubbles
- **Outgoing (@username):** Pastel Mint background, aligned right, with an exaggerated 24px radius.
- **Incoming:** Clay-White background, aligned left.
Both use inner shadows to appear 3D. The "tail" is replaced by a simple asymmetrical corner radius (e.g., 24px on three corners, 8px on the bottom-trailing corner).

### Input Fields
Search bars and message inputs are white, pill-shaped, and "inset." Unlike cards, these use a heavy **Inner Shadow** and no outer shadow, making them look like they are carved into the clay surface.

### Chips & Tags
Small, highly rounded indicators for status. These use the Secondary Green for high contrast, appearing as small "beads" on the UI.
