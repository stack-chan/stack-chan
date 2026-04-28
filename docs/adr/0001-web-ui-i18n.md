# ADR 0001: Lightweight i18n for the Web UI

Date: 2026-04-28

## Status

Accepted

## Context

Stack-chan is expected to be used by people in multiple regions. The current `web/` tools are static HTML pages with vanilla JavaScript, including the preference UI and firmware flashing UI. These pages contain user-facing English strings directly in HTML and inline scripts.

The UI language setting is separate from Stack-chan's voice, TTS, speech, and conversation language settings. Changing the Web UI language must not change `tts.*`, voice selection, AI context, or any future conversation-language configuration.

The firmware UI is intentionally out of scope for this decision. If firmware-side UI localization is introduced later, it should prefer Moddable's built-in i18n support rather than sharing the browser implementation directly.

## Decision

Use a lightweight custom i18n implementation for the Web UI instead of adding a general-purpose i18n library.

The initial Web UI i18n implementation will:

- Support `ja`, `en`, and `zh-Hans` as the initial locale set.
- Use `en` as the fallback locale.
- Keep UI locale state separate from TTS, voice, and conversation settings.
- Mark translatable text with `data-i18n`.
- Mark translatable attributes with dedicated attributes such as:
  - `data-i18n-placeholder`
  - `data-i18n-title`
  - `data-i18n-aria-label` when needed
- Resolve the browser-side locale in a predictable order, such as:
  1. URL query parameter (`?lang=...`)
  2. `localStorage`
  3. `navigator.language`
  4. fallback locale (`en`)
- Include checks that detect missing or extra translation keys across supported locales.

## Rationale

The current Web UI does not use a bundler or SPA framework. Adding a larger OSS i18n dependency such as i18next, FormatJS, Fluent, or a code-generation-based library would add more moving parts than the current static pages need.

A small dictionary plus `t(locale, key)` helper is enough for the current UI and keeps the implementation easy to audit. Attribute-specific markers also cover placeholders, titles, and accessible labels without coupling translation behavior to page-specific scripts.

Keeping Web UI localization separate from speech-related settings prevents accidental behavior changes where a user changes the configuration screen language and unexpectedly changes Stack-chan's voice or conversation language.

## Tone and terminology guidance

Translation keys should be stable implementation identifiers, not one-off copies of current labels. Before broad label changes, user-facing vocabulary should be aligned around the product tone.

For Stack-chan-related management UI, prefer soft user-facing vocabulary over exposing internal English concepts directly. In particular, future labels around the enterprise/product model should treat these concepts as central vocabulary:

- `ｽﾀｯｸﾁｬﾝ = なかみ + からだ`
- `はたらくｽﾀｯｸﾁｬﾝ = ｽﾀｯｸﾁｬﾝ + おしごと`
- `おしごと` is optional.
- `なかみ + からだ` is enough for a conversational Stack-chan.
- `おしごと` is an added role for real-world tasks such as reception, guidance, or sales support.
- Prefer `なかみ`, `からだ`, and `おしごと` in normal management UI.
- Use `魂` sparingly; reserve it for onboarding or world-building explanations rather than everyday management UI.

The tone document is not itself the glossary. Glossary entries and i18n label keys should be managed separately, but they should follow these naming and screen-structure rules.

## Consequences

### Positive

- Minimal dependency and build impact.
- Works with the current static HTML + vanilla JavaScript structure.
- Easy to apply incrementally to `web/preference/index.html` and `web/flash/index.html`.
- Clear separation between UI language and voice/conversation behavior.
- Firmware remains free to use Moddable's own i18n mechanism later.

### Negative

- The custom implementation must maintain basic i18n behavior itself.
- Advanced localization features such as plural rules, rich message formatting, and locale-specific formatting are not included initially.
- Translation key coverage checks are necessary to avoid silent missing strings.

## Alternatives considered

### i18next

A mature and widely used i18n library. It supports fallback, namespaces, interpolation, and language detection, but it is heavier than needed for the current static Web UI.

### FormatJS / react-intl

Powerful for applications that need rich formatting and framework integration, but too large and framework-oriented for the current vanilla Web UI.

### Fluent

Expressive and suitable for complex natural-language localization, but unnecessary for the current small set of UI labels.

### typesafe-i18n

Attractive for TypeScript projects with generated, type-safe translation access. It introduces a code-generation workflow that is not necessary while `web/` remains simple static HTML.

## Related task

- GitHub issue: https://github.com/stack-chan/stack-chan/issues/400
