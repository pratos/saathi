---
name: Saathi
description: A calm, accessible family messenger with a luminous mobile assistant presence.
colors:
  mobile-ink: "#1c1c24"
  mobile-muted: "#646574"
  pearl-canvas: "#fffdfb"
  lilac-signal: "#ddd5ff"
  blush-signal: "#ffe1e6"
  sky-signal: "#d9edff"
  action-violet: "#6f59bd"
typography:
  headline:
    fontFamily: "Manrope, Noto Sans Devanagari Variable, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Manrope, Noto Sans Devanagari Variable, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
  body:
    fontFamily: "Manrope, Noto Sans Devanagari Variable, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Manrope, Noto Sans Devanagari Variable, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  control: "18px"
  card: "22px"
  floating: "26px"
  circle: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action-violet}"
    textColor: "{colors.pearl-canvas}"
    rounded: "{rounded.control}"
    height: "50px"
    padding: "0 18px"
  card-mobile:
    backgroundColor: "rgba(255,255,255,.76)"
    textColor: "{colors.mobile-ink}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Saathi

## Overview

**Creative North Star: "The Luminous Family Room"**

Saathi combines an operational desktop workspace with a calmer mobile messenger. Mobile uses a warm pearl canvas, diffused blush/lilac/sky light, and a small number of translucent floating layers so the assistant feels present without competing with family content. The experience must remain obvious to older adults while still feeling current to younger family members.

**Key Characteristics:**
- Light, spatial mobile surfaces with dark, high-contrast copy.
- Manrope for Latin text and Noto Sans Devanagari for Hindi and Marathi glyphs.
- Labeled consequential controls, 48px-or-larger primary touch targets, and wrapping rather than truncation.
- Lucide icons with consistent strokes; words remain visible where an icon alone could be ambiguous.

## Colors

The mobile palette is quiet at rest and uses soft spectral color to distinguish presence, selection, and action.

### Primary
- **Action Violet:** Reserved for Send and other clear primary actions.

### Secondary
- **Signal Lilac, Blush, and Sky:** Used in ambient gradients, assistant tiles, selected navigation, and voice presence. They support hierarchy rather than carrying body text.

### Neutral
- **Pearl Canvas:** The near-white mobile field.
- **Mobile Ink:** Primary text and icon color.
- **Mobile Muted:** Secondary copy that still meets readable contrast on light surfaces.

**The Ambient Color Rule.** Pastels belong in backgrounds, selection fills, and presence effects; never use them as low-contrast body text.

## Typography

**Display Font:** Manrope with Noto Sans Devanagari and system sans fallbacks.
**Body Font:** Manrope with Noto Sans Devanagari and system sans fallbacks.

**Character:** Geometric and contemporary without becoming clinical. Devanagari text receives a script-appropriate face instead of forcing Manrope to render glyphs it does not contain.

### Hierarchy
- **Headline** (800, 30px, 1.1): Mobile screen titles.
- **Title** (800, 18px, 1.25): Room, card, and status titles.
- **Body** (500–600, 16–18px, 1.45): Messages, transcripts, and important descriptions.
- **Label** (800, 10–12px): Short metadata and section labels; use uppercase only for brief operational labels.

**The Full-Value Rule.** Recipients, subjects, amounts, deadlines, source labels, and confirmations wrap; they are never clamped or ellipsized.

## Layout

Mobile uses one primary column below 820px. Headers, navigation, and the composer float above the ambient field, while conversation and inbox content remain scrollable with reserved space for fixed controls. Use `minmax(0, 1fr)`, `min-width: 0`, and `overflow-wrap: anywhere` around dynamic family content. Desktop retains the denser rail/list/workspace composition.

## Elevation & Depth

Depth is ambient rather than structural. Floating mobile controls use translucent white, backdrop blur, a subtle white border, and broad low-opacity violet shadows. Content cards use lighter shadows than navigation or modal layers.

### Shadow Vocabulary
- **Floating:** `0 18px 46px rgba(80,66,116,.12), 0 2px 8px rgba(77,65,109,.06)` for headers and navigation.
- **Content:** `0 10px 28px rgba(71,62,96,.08)` for messages and inbox cards.

**The Selective Glass Rule.** Blur belongs on genuinely floating layers; ordinary content surfaces remain mostly opaque and readable.

## Shapes

Mobile cards use 18–26px radii, circular utility controls, and asymmetric message corners to indicate speaker direction. Borders are one-pixel, low-chroma separators. Avoid decorative one-sided accent bars.

## Components

### Buttons
- **Shape:** Rounded controls (18–22px) with a minimum 48px mobile target.
- **Primary:** White text on Action Violet; disabled actions use a neutral light fill with readable muted text.
- **Secondary:** Translucent white with a subtle violet border. Labels wrap instead of shrinking.

### Cards / Containers
- **Corner Style:** 22px on mobile content surfaces.
- **Background:** Translucent white over the ambient pearl field.
- **Border:** One-pixel white or low-chroma violet.
- **Internal Padding:** 16px baseline.

### Inputs / Fields
- **Style:** The mobile composer is a 25px-radius translucent dock with a 16px text field and a distinct Send action.
- **Focus:** Preserve the platform focus ring or provide an equally visible violet focus treatment.

### Navigation
- **Mobile:** Four labeled Lucide actions in a floating translucent capsule. The active destination receives a lilac-to-sky fill, not color alone.
- **Desktop:** Compact operational rail and workspace navigation.

### Voice Presence

Voice mode uses a central soft-spectrum presence, plain-language listening/speaking status, a readable transcript, a separately scrollable activity panel, and persistent labeled Mute and End call controls.

## Do's and Don'ts

### Do:
- **Do** retain explicit labels for Send, Mute, End call, invitations, extraction, and confirmations.
- **Do** verify English, Hindi, and Marathi wrapping at 390–412px widths.
- **Do** reserve viewport space for floating navigation and voice controls.
- **Do** respect reduced-motion preferences and keep presence motion to opacity, filter, and transform.

### Don't:
- **Don't** return mobile surfaces to a black dashboard treatment.
- **Don't** use emoji, text glyphs, or letter avatars where a Lucide icon communicates the same role.
- **Don't** stack blur on every surface or let pastel decoration reduce text contrast.
- **Don't** hide critical values or consequential actions behind truncation.
