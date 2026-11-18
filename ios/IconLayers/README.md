# SACORO app icon, as layers for Apple's Icon Composer

The founder, on the 3D icon: "a 3D-looking image isn't automatically a native
layered icon. For iOS, Claude will eventually need to prepare the actual
separate artwork layers for Apple's icon tools."

From iOS 26, Apple draws an app's icon itself: it takes flat layers and adds
the glass, the light and the depth, in the light, dark and tinted looks the
athlete chooses. The Porcelain icon's 3D look is what Apple's renderer is
meant to produce from these, so the layers here are **flat**: one colour each,
no shading, no shadow.

| Layer | File | Colour |
|---|---|---|
| 1, bottom | `1-background.svg` / `.png` | the tile: a dark vertical gradient, rgb(47,52,56) to rgb(7,8,12) |
| 2 | `2-S.svg` / `.png` | the S, rgb(220,217,208) |
| 3 | `3-dots.svg` / `.png` | the two dots, gold rgb(176,147,93) |
| 4, top | `4-ACORO.svg` / `.png` | the name, cherry rgb(196,106,137) |

All are 1024 by 1024, full bleed, square corners (Apple masks the corners),
cut from the same artwork as every other SACORO icon and in the same place.
`preview-flat.png` is the four laid together. The SVGs are traced from the
artwork and recombine within 1 of 255 of the PNGs.

## Making the .icon file (needs a Mac with Xcode 26)

1. Open **Icon Composer** (Xcode, Open Developer Tool, Icon Composer).
2. Drag in the four SVGs, bottom to top: background, S, dots, ACORO.
   Put the S and the dots in one group so they catch the light together;
   ACORO in its own.
3. Give the S and the dots Liquid Glass; leave the background and ACORO plain.
   Check the Default, Dark and Tinted looks.
4. Save as `AppIcon.icon` into `ios/App/App/`, add it to the App target,
   and keep the icon name `AppIcon`.

Until that is done, and on iOS 18 and earlier always, the app uses the
Porcelain icon already in `App/Assets.xcassets/AppIcon.appiconset`
(1024 by 1024, no transparency, as Apple requires).
