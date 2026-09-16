import { v } from "convex/values";

export const IMAGE_KINDS = ["scene", "infographic", "devotional"] as const;
export const IMAGE_LANGUAGES = ["en", "hi", "mr"] as const;
export const IMAGE_PRESET_GROUPS = ["family", "infographic", "devotional", "art"] as const;

export const IMAGE_PRESETS = [
  { id: "warm_family", group: "family", label: "Warm household", hint: "Soft light, gentle faces", direction: "Warm, dignified family illustration with soft natural light, gentle faces, and a calm Indian household atmosphere." },
  { id: "kitchen_table", group: "family", label: "Kitchen table", hint: "Everyday cooking and meals", direction: "Intimate kitchen-table scene with brass and steel utensils, steam, and everyday Indian home cooking, modest and wholesome." },
  { id: "festival_home", group: "family", label: "Festival at home", hint: "Lights, sweets, family gathering", direction: "Joyful family festival at home with diyas, sweets, and modest festive clothing. Keep it intimate and household-scale, not a crowded public spectacle." },
  { id: "storybook", group: "family", label: "Storybook", hint: "Gentle pages for children", direction: "Gentle children's storybook illustration with rounded shapes, kind faces, and a calm bedtime palette. Keep clothing modest." },
  { id: "family_collage", group: "family", label: "Photo collage", hint: "Overlapping household photos", direction: "A warm household photo collage of overlapping family snapshots on a corkboard or album page, modest clothing, no celebrity lookalikes, no watermarks." },
  { id: "memory_grid", group: "family", label: "Album grid", hint: "Neat 2x2 or 3x3 photos", direction: "A neat family album grid, two or three rows of household photos with thin white borders and short handwritten-style captions." },
  { id: "scrapbook", group: "family", label: "Scrapbook", hint: "Washi tape and captions", direction: "A handmade family scrapbook spread with washi tape, ticket stubs, and short captions. Wholesome, modest, and clearly a craft page rather than a poster." },
  { id: "fridge_photos", group: "family", label: "Fridge photos", hint: "Magnets, notes, snapshots", direction: "Family photos and school notes on a refrigerator door with magnets and a grocery list. Everyday Indian kitchen, modest and uncluttered." },
  { id: "infographic", group: "infographic", label: "Clean chart", hint: "Icons and short labels", direction: "Clean educational infographic with large readable labels, simple icons, generous spacing, and a muted teal-and-amber palette." },
  { id: "step_cards", group: "infographic", label: "Step cards", hint: "Numbered how-to", direction: "Numbered step-by-step cards, 3 to 5 large steps, thick icons, high contrast, and almost no decoration so the sequence is obvious." },
  { id: "kids_chart", group: "infographic", label: "Kids chart", hint: "Big type for children", direction: "Child-friendly classroom chart with extra-large type, friendly icons, and a simple grid. No tiny footnotes." },
  { id: "wall_poster", group: "infographic", label: "Wall poster", hint: "One idea, bold type", direction: "Single-topic wall poster with one headline, three supporting points, and a strong focal icon. Leave breathing room around every label." },
  { id: "devotional", group: "devotional", label: "Serene shrine", hint: "Modest sacred art", direction: "Respectful Indian devotional artwork with serene lighting, traditional motifs, and modest, non-sensational sacred imagery." },
  { id: "diya_aarti", group: "devotional", label: "Diya aarti", hint: "Lamps and evening prayer", direction: "Quiet evening aarti with glowing diyas, incense, and folded hands. Keep clothing modest and faces serene. Do not sensationalize sacred figures." },
  { id: "rangoli", group: "devotional", label: "Rangoli", hint: "Floor patterns and color", direction: "Intricate household rangoli on a clean floor, viewed from a respectful angle, with marigolds and diyas. Decorative, not eroticized." },
  { id: "festival_altar", group: "devotional", label: "Home altar", hint: "Puja thali and flowers", direction: "A modest home altar with a puja thali, flowers, and a small shrine. Intimate, clean, and suitable for a family living room." },
  { id: "watercolor", group: "art", label: "Watercolor", hint: "Airy washes", direction: "Soft watercolor illustration with airy washes, paper texture, and calm colors." },
  { id: "flat", group: "art", label: "Flat vector", hint: "Simple shapes", direction: "Flat vector illustration with simple shapes, limited colors, and clear silhouettes." },
  { id: "folk_art", group: "art", label: "Folk art", hint: "Madhubani-inspired pattern", direction: "Indian folk-art inspired illustration with rhythmic patterns, natural dyes, and decorative borders. Stylized, not photorealistic, and fully clothed." },
  { id: "block_print", group: "art", label: "Block print", hint: "Textile motifs", direction: "Hand block-print textile look with repeated floral or geometric motifs, indigo and madder tones, and a calm craft-studio mood." },
] as const;

export type ImagePreset = (typeof IMAGE_PRESETS)[number];
export type ImageStyle = ImagePreset["id"];
export type ImageKind = (typeof IMAGE_KINDS)[number];
export type ImageLanguage = (typeof IMAGE_LANGUAGES)[number];
export const IMAGE_STYLES = IMAGE_PRESETS.map(preset => preset.id);

export const imageStyleValidator = v.union(
  v.literal("warm_family"), v.literal("kitchen_table"), v.literal("festival_home"), v.literal("storybook"),
  v.literal("family_collage"), v.literal("memory_grid"), v.literal("scrapbook"), v.literal("fridge_photos"),
  v.literal("infographic"), v.literal("step_cards"), v.literal("kids_chart"), v.literal("wall_poster"),
  v.literal("devotional"), v.literal("diya_aarti"), v.literal("rangoli"), v.literal("festival_altar"),
  v.literal("watercolor"), v.literal("flat"), v.literal("folk_art"), v.literal("block_print"),
);
export const imageKindValidator = v.union(v.literal("scene"), v.literal("infographic"), v.literal("devotional"));
export const imageLanguageValidator = v.union(v.literal("en"), v.literal("hi"), v.literal("mr"));

const NSFW_PATTERN = /\b(nsfw|nude|naked|nudity|porn|pornograph(?:y|ic)|xxx|onlyfans|sexual(?:ly)?|sex\b|erotic|hentai|fetish|bdsm|orgasm|masturbat(?:e|ion)|blowjob|handjob|cumshot|genitals?|penis|vagina|vulva|anus|anal|boobs?|breasts?|nipples?|areola|cleavage|lingerie|strip(?:per|ping)?|seduc(?:e|tive)|aroused|horny|kinky|incest|bestiality|rape|non-?consensual|child\s*porn|cp\b|underage|lolita|preteen|gory|gore|dismember|decapitat|bloodbath|torture)\b/i;
const MINOR_SEXUAL_PATTERN = /\b((child|kid|kids|minor|underage|teen(?:ager)?s?|boy|girl|infant|toddler|baby).{0,40}(sex|nude|naked|porn|erotic|seduc)|sexualiz(?:e|ed|ing)\s+(child|kid|minor|teen))\b/i;
const VIOLENCE_PATTERN = /\b(behead|dismember|eviscerat|snuff|mass\s+shooting|graphic\s+violence|gore|gory)\b/i;

const KIND_DIRECTIONS: Record<ImageKind, string> = {
  scene: "A single wholesome scene suitable for a family chat.",
  infographic: "A family-friendly infographic that teaches one idea with short labels and no tiny unreadable text.",
  devotional: "A respectful devotional image for household worship or festivals. Keep clothing modest. Do not sensationalize sacred figures.",
};

const LANGUAGE_DIRECTIONS: Record<ImageLanguage, string> = {
  en: "Any visible text must be in clear English.",
  hi: "Any visible text must be in clear Hindi (Devanagari).",
  mr: "Any visible text must be in clear Marathi (Devanagari).",
};

const PRESET_BY_ID = Object.fromEntries(IMAGE_PRESETS.map(preset => [preset.id, preset])) as Record<ImageStyle, ImagePreset>;

export function isImageStyle(value: unknown): value is ImageStyle {
  return typeof value === "string" && value in PRESET_BY_ID;
}

export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === "string" && (IMAGE_KINDS as readonly string[]).includes(value);
}

export function isImageLanguage(value: unknown): value is ImageLanguage {
  return typeof value === "string" && (IMAGE_LANGUAGES as readonly string[]).includes(value);
}

export function imagePreset(value: unknown): ImagePreset {
  return isImageStyle(value) ? PRESET_BY_ID[value] : PRESET_BY_ID.warm_family;
}

export function familySafeImageFailure(prompt: string) {
  const text = prompt.trim();
  if (MINOR_SEXUAL_PATTERN.test(text)) return "Saathi cannot create sexual or suggestive images involving children.";
  if (NSFW_PATTERN.test(text)) return "Saathi only creates family-safe images. That request is not allowed.";
  if (VIOLENCE_PATTERN.test(text)) return "Saathi cannot create graphic or violent images.";
  return null;
}

export function composeFamilyImagePrompt(options: {
  prompt: string;
  style?: string;
  kind?: string;
  language?: string;
}) {
  const prompt = options.prompt.trim();
  if (prompt.length < 3 || prompt.length > 2_000) throw new Error("Describe the image in a short family-safe request.");
  const blocked = familySafeImageFailure(prompt);
  if (blocked) throw new Error(blocked);
  const preset = imagePreset(options.style);
  const kind = isImageKind(options.kind)
    ? options.kind
    : preset.group === "infographic" ? "infographic" : preset.group === "devotional" ? "devotional" : "scene";
  const language = isImageLanguage(options.language) ? options.language : "en";
  return [
    prompt,
    KIND_DIRECTIONS[kind],
    preset.direction,
    LANGUAGE_DIRECTIONS[language],
    "Family-safe content only: no nudity, sexual content, lingerie, gore, or real-world hate.",
    "Do not depict anyone looking under 18 in a romantic, sexual, or suggestive way.",
  ].join(" ");
}

export function imageCaption(prompt: string, kind: ImageKind, language: ImageLanguage) {
  const label = kind === "infographic" ? "Infographic" : kind === "devotional" ? "Devotional image" : "Image";
  const languageLabel = language === "hi" ? "Hindi" : language === "mr" ? "Marathi" : "English";
  return `${label} · ${languageLabel}: ${prompt.trim()}`.slice(0, 280);
}

export const GENERATE_IMAGE_TOOL = {
  type: "function",
  name: "generate_image",
  description: "Create one family-safe image and attach it to this conversation. Use for explicit image requests, language-specific infographics, or respectful devotional art. Pick a named preset style when the caller asks for a look. Never create sexual, nude, pornographic, or graphic violent images.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 3, maxLength: 2_000, description: "What to show, without sexual or violent detail." },
      kind: { type: "string", enum: IMAGE_KINDS, description: "scene for a picture, infographic for labeled teaching art, devotional for respectful worship imagery." },
      style: { type: "string", enum: IMAGE_STYLES, description: "Named family preset such as warm_family, kids_chart, diya_aarti, or folk_art." },
      language: { type: "string", enum: IMAGE_LANGUAGES, description: "Language for any visible labels." },
    },
    required: ["prompt", "kind"],
  },
} as const;
