# Nano media studio for WordPrais articles

Use the Make blueprint media logic from `RU SEO-GEO STAT'I DLYA BLOGA 2026.blueprint`:

- module `5`, designer name `Oblozhka`, aspect ratio `16:9`;
- module `9`, designer name `banner`, aspect ratio `21:9`;
- primary model chain: `nano_banana_pro -> gpt_image_2 -> nano_banana_2 -> any available MCP image model`;
- generated media must be uploaded to WordPress and returned as permanent WordPress media URLs before publication.

Publication is blocked if either the featured cover or the in-article banner is missing, not uploaded, or not usable.

## Face references

Always pass these URLs as image references unless `NANO_REFERENCE_IMAGE_URLS` or `NANO_IMAGE_INPUT_URLS` overrides them:

1. `http://bytmaster34.ru/wp-content/uploads/2026/05/1776706200543-lxk48gqcs3c-224x300.jpg`
2. `http://bytmaster34.ru/wp-content/uploads/2026/05/1776707366899-9kshlushgiv-224x300.jpg`
3. `http://bytmaster34.ru/wp-content/uploads/2026/05/1776710984257-8p4bnpwivq9-224x300.jpg`

`identity_lock=true`: the first reference is the main identity anchor. Keep the same face, age range, glasses, facial proportions, recognizability, and realistic skin texture. The additional references are face-consistency references. Do not replace the person with a stock model.

Hard negative identity rules:

- no cap;
- no hood;
- no cartoon;
- no 3D render;
- no anime;
- no plastic skin;
- no distorted face;
- no distorted hands;
- no different person;
- no Latin or English text in the image.

## Cover prompt, 16:9 featured image

Create a hyper-realistic action selfie photo cover for a Russian WordPress / SEO / GEO / AI-search article on `wordprais.ru`.

Base style from the Make blueprint:

- photorealistic wide-angle selfie, 24mm lens feel;
- the author from the face references is close to camera;
- face is ultra-sharp, with visible pores, stubble/skin texture, real eye reflections, realistic glasses;
- the author may have a confident, focused, slightly ironic or dynamic expression;
- cinematic editorial lighting, high detail, real camera look, not illustration.

Adapt the scene to the article topic and WordPrais niche:

- WordPress development, site architecture, admin dashboards, plugins, themes, backups, security, recovery, SEO/GEO, analytics, content publishing, AI-search visibility;
- if the keyword is about hacked WordPress or recovery, show a realistic technical recovery/workstation scene, not fantasy;
- if the keyword is about site development, show architecture, prototypes, CMS screens, content blocks, QA checklist, launch preparation;
- if the keyword is about SEO/GEO, show search snippets, analytics panels, schema, semantic clusters, local visibility, but do not put fake statistics into the image.

Text rules:

- use only short Russian Cyrillic text if text is needed;
- headline must be a short visual version of the article topic, not the full SEO title;
- no English words, no Latin letters, no random UI gibberish;
- no fake logos of third-party services;
- no `@maya_pro`, no Kovcheg+, no Make/course/channel branding unless the article is explicitly about them.

Output:

- aspect ratio `16:9`;
- format `png` for `nano_banana_pro` / `gpt_image_2`, `jpg` only if fallback model requires it;
- preferably `2K` when available, otherwise the model's stable resolution.

## Banner prompt, 21:9 in-article banner

Create a photorealistic designer banner for the same article. It must visually belong to the cover but be calmer and wider.

Base style from the Make blueprint:

- photorealistic, stylish, modern;
- the same author from references, identity locked;
- professional glasses, no cap, no hood;
- strong Russian editorial look, clean composition;
- topic-specific WordPress / SEO / GEO / AI-search context.

Banner composition:

- wide horizontal `21:9`;
- use enough negative space for a short Russian Cyrillic headline;
- background may be a clean studio gradient, realistic workstation, WordPress dashboard, analytics wall, site audit scene, or technical service environment;
- keep the banner useful inside an article, not a social-media ad;
- avoid clutter, random objects, fake charts, fake unreadable tables, and stock-photo people.

Text rules:

- Russian Cyrillic only;
- short, readable, topic-specific;
- no Latin, no English, no fake service logos.

Output:

- aspect ratio `21:9`;
- format `png` for `nano_banana_pro` / `gpt_image_2`, `jpg` only if fallback model requires it;
- upload to WordPress and use the permanent WordPress media URL in the article body.
