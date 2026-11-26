# Desktop Dog 🐶

A cute, **stationary** pixel-art puppy that sits quietly on your GNOME desktop.
It blinks, wags its tail and breathes on its own, and becomes interactive when
you click, drag, pet or feed it. It **never** walks, jumps, falls, climbs
windows, or wanders around by itself.

- **Target:** GNOME Shell **46** (Ubuntu 24.04 LTS, X11 or Wayland)
- **Type:** native GNOME Shell extension (GJS / Clutter / St) — no Electron,
  Python, Qt, web view, or background service.

---

## Architecture (brief)

```
extension.js
 └─ DesktopDogExtension (extends Extension)  enable()/disable()
     └─ DogManager
         ├─ St.Widget  "container"   ← reactive, added to Shell chrome
         │    ├─ St.Icon  (current pose, an SVG swapped on state change)
         │    └─ St.Label (floating ♥ / ✨ / z effects)
         ├─ PopupMenu  (right-click context menu) + PopupMenuManager
         ├─ GSettings  (size, position, toggles… persisted)
         └─ timers / Clutter transitions (idle, breathing, reactions)
```

Key design points:

- **Overlay without blocking the desktop.** The container is added with
  `Main.layoutManager.addChrome(container, { affectsInputRegion: true,
  trackFullscreen: true })`. Only the dog's own box is part of the input
  region, so clicks anywhere else still reach your windows normally. It floats
  above normal windows and hides automatically over fullscreen windows.
- **Poses are sprites, motion is Clutter.** Each expression (idle, blink, happy,
  wag, sleep, eating, playing, petted) is a crisp SVG. Movement (breathing,
  bounce, wiggle, nod) uses `actor.ease(...)` property transitions. Breathing is
  a single infinite auto-reversing transition, so idle cost is negligible.
- **Dragging** uses the same mechanism GNOME's own drag-and-drop uses:
  `global.stage.grab(actor)` + an `event` handler switching on
  `MOTION` / `BUTTON_RELEASE`, then `grab.dismiss()`.
- **Everything is torn down in `disable()`** — timers (`GLib.Source.remove`),
  transitions (`remove_all_transitions`), signal handlers, the grab, the menu,
  and the chrome actor.

---

## Features

**Idle (does nothing on its own except gentle life):**
occasional blink, occasional tail wag, subtle breathing. Stays exactly where it
is.

**Interactions:**

| Action | Result |
|---|---|
| Single click | Happy reaction (little bounce + ♥) |
| Double click | Playful animation (double hop + ✨, tongue out) |
| Click & drag | Move the dog anywhere; it stays where you drop it |
| Right click | Context menu |

**Context menu:** Pet · Feed · Play · Sleep/Wake · Sound toggle ·
Reset position · Hide dog · Preferences.

**Preferences:** show/hide, dog size, initial corner, enable animations, idle
breathing, idle frequency, sound, reset position, reset all.

Position (and sleep state) are remembered across GNOME Shell restarts.

---

## Installation (Ubuntu 24.04, GNOME 46)

### Option A — one command (recommended)

```bash
cd "desktop-dog@custom.local"
./install.sh
```

This copies the extension to `~/.local/share/gnome-shell/extensions/` and
compiles the schema. Then restart the shell and enable it (see below).

### Option B — manual

```bash
# 1. Copy into your user extensions folder
UUID="desktop-dog@custom.local"
mkdir -p ~/.local/share/gnome-shell/extensions/$UUID
cp -r "desktop-dog@custom.local/." ~/.local/share/gnome-shell/extensions/$UUID/

# 2. Compile the GSettings schema (REQUIRED — the extension won't load without it)
glib-compile-schemas ~/.local/share/gnome-shell/extensions/$UUID/schemas/
```

### Restart GNOME Shell

- **X11:** press `Alt`+`F2`, type `r`, press `Enter`.
- **Wayland:** log out and log back in.

### Enable it

Using the **Extension Manager** app: open it, find **Desktop Dog** under
*Installed*, and flip its switch on. Its gear icon opens Preferences.

Or from a terminal:

```bash
gnome-extensions enable desktop-dog@custom.local
```

The puppy appears in the bottom-right corner.

---

## Debugging

GNOME Shell logs extension errors to the journal:

```bash
# Follow shell + extension messages live
journalctl --user -f -o cat /usr/bin/gnome-shell

# Just this extension's recent messages
journalctl --user -b 0 | grep -i desktop-dog
```

Check state / list:

```bash
gnome-extensions info desktop-dog@custom.local
gnome-extensions list --enabled
```

If it fails with *“Schema … could not be found”*, the schema wasn't compiled —
re-run the `glib-compile-schemas …/schemas/` step and restart the shell.

---

## Uninstall

```bash
./uninstall.sh
```

or manually:

```bash
gnome-extensions disable desktop-dog@custom.local
rm -rf ~/.local/share/gnome-shell/extensions/desktop-dog@custom.local
dconf reset -f /org/gnome/shell/extensions/desktop-dog/   # forget saved settings
```

Then restart GNOME Shell.

---

## Notes & limitations (honest)

- **Sound** is **off by default**. When enabled it uses the optional **GSound**
  library to play a short system cue. No custom bark audio is bundled; if GSound
  isn't available the toggle simply stays silent (no errors). To add a real
  bark, drop a `bark.oga` into `assets/` and adjust `_playSound()`.
- **Hiding the dog** from the context menu sets *Show the dog* off. To bring it
  back, open **Preferences** and turn *Show the dog* back on (there's
  deliberately no always-on tray icon, to keep things minimal).
- **Transparent corners are still clickable.** The input region is the dog's
  bounding box (a rectangle), so fully-transparent pixels inside that box still
  catch a click. This is a GNOME Shell input-region limitation (regions are
  rectangles); the effect is tiny at this sprite size.
- **Fullscreen windows** hide the dog (by design, via `trackFullscreen`) so it
  never covers videos or games. It reappears when you leave fullscreen.
- The sprites are generated by `tools/gen_dog.py` (pure Python + Pillow) for
  reproducibility; the committed SVGs in `assets/` are the output.

---

## Project layout

```
desktop-dog@custom.local/
├── metadata.json          # GNOME 46 extension manifest
├── extension.js           # the extension (DogManager + lifecycle)
├── prefs.js               # libadwaita/GTK4 preferences
├── stylesheet.css         # transparent host widget + effect label styling
├── schemas/
│   └── org.gnome.shell.extensions.desktop-dog.gschema.xml
├── assets/                # dog-idle / blink / wag / happy / sleep / eating / playing / petted .svg
├── tools/gen_dog.py       # sprite generator (dev only; not required at runtime)
├── install.sh / uninstall.sh
└── README.md
```
