# App icon source

`Anviq.icon` is the shared editable source for macOS and iOS. Open it in Apple's
Icon Composer with Xcode 26 or newer. The foreground is the Sekundo placeholder mark
(`Assets/sekundo-mark.png`) in off-white, centered on the system dark background.

macOS packaging compiles the source into a Tahoe asset catalog and generates the
legacy ICNS fallback. Expo copies the same source into the iOS project.

The platform exports are:

- `apps/desktop/assets/icon-macos.png`: 1024-pixel macOS pre-Tahoe export, including
  Dock margins for development launches.
- `apps/mobile/assets/icon.png`: opaque 1024-pixel square for the generic/legacy icon,
  with no rounded mask or Dock margins.
- `apps/mobile/assets/adaptive-icon.png`: transparent 1024-pixel Android foreground,
  inside the launcher's safe area.
- `apps/mobile/assets/icon-background.png`: opaque Android background in the
  paper tone (`#F2F2F0`).
- `apps/mobile/assets/monochrome-icon.png`: matching Android alpha silhouette for
  themed launchers.

Android supplies its own mask; never bake Mac corners, a rim, or an outer shadow into
adaptive layers.

The mark is a placeholder. When the final logo exists, replace `sekundo-mark.png`, the
platform exports above, `apps/web/public` icons, `apps/desktop/assets/icon*`, and
`apps/mobile/modules/anviq-notifications/android/src/main/res/drawable/ic_anviq_notification.xml`.
`scripts/export-brand.ts` expects a source image that this repository does not contain.
