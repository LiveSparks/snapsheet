<div align="center">

# SNAPSHEET

**Turn a roll of photos into print-ready sheets, right in your browser.**

Polaroids with handwritten-style dates, tidy grids, tightly packed prints, or a freeform canvas where you place and size every photo yourself, with cut guides, per-photo edits and exports at real physical sizes.

[**▶ Open the app**](https://livesparks.github.io/snapsheet/) · [Features](#features) · [How to use](#how-to-use) · [Run locally](#run-locally)

![SNAPSHEET: the app with a captioned polaroid sheet, beside the exported print-ready sheet with crop marks](docs/screenshots/hero.jpg)

</div>

> [!CAUTION]
> **This project is entirely LLM-coded.** Every line was written by AI coding assistants, with a human directing the work and testing by hand. There is no automated test suite. Expect rough edges, check your exports before printing on expensive paper, and use it with caution. Bug reports and pull requests are welcome.

## Why

Printing a stack of phone photos at home usually means fighting a word processor or paying for a print shop. SNAPSHEET lays photos out on A4, Letter or any paper size at exact millimetre dimensions. It adds crop marks so you can cut them cleanly and renders sheets at photo-print resolution. **Nothing is uploaded:** every photo is decoded, edited and rendered on your own device.

## Features

**Layouts**
- **Polaroid:** white border plus a date or caption band, in handwritten-style lettering
- **Grid:** fixed cells, crop to fill or fit inside
- **Flow:** keeps each photo's proportions and packs tightly to save paper
- **Free:** place and size every photo yourself

**Freeform canvas**
- Drag, resize and move photos between sheets
- Snaps to margins, page centre, other photos and the spacing gap
- Multi-select, then align, distribute, auto-arrange or change stacking order
- Arrow-key nudging, undo and redo

**Sizes & paper**
- Presets from passport to 8×10″, or any custom size in mm or inches
- Sizes can follow each photo's orientation; save your own
- A3 to 4×6″ paper or custom, with adjustable margins and spacing
- Auto orientation picks whichever uses fewer sheets

**Printing**
- Cut guides as crop marks, full lines or edge marks, in five ink colours
- Show or hide guides in the preview, separately from print
- 150 to 600+ dpi rendering at exact physical size
- Print directly, or export JPG, PNG or a multi-page PDF
- Live sheet, photo and paper-coverage counts

**Photos**
- JPG, PNG, WebP, GIF and iPhone HEIC/HEIF
- Add with the file picker, drag and drop, or paste
- Crop and zoom in frame, rotate, adjust colour and sharpening
- Per-photo captions or automatic file dates
- Save adjustment presets and apply them in one tap
- Hide a photo from the layout without removing it

**Convenience**
- Your work survives a reload; **New** starts a blank project
- Settings are remembered between visits
- Works on phones and tablets
- Runs entirely on your device: no account, no uploads

## Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/freeform.jpg" alt="Freeform canvas with snapping guides and resize handles"><br><sub><b>Freeform:</b> mixed print sizes on one sheet, a photo snapping to its neighbours mid-drag.</sub></td>
<td width="50%"><img src="docs/screenshots/editor.jpg" alt="Photo editor with adjustments and crop"><br><sub><b>Editor:</b> crop in frame, rotate, tune colour and sharpening, add a caption.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/grid.jpg" alt="Grid layout with crop marks"><br><sub><b>Grid:</b> uniform cells with crop marks for clean cutting.</sub></td>
<td width="50%"><img src="docs/screenshots/landing.jpg" alt="Start screen"><br><sub><b>Start:</b> drop, pick or paste photos. Everything stays on-device.</sub></td>
</tr>
</table>

## How to use

1. **Add photos.** Click **Add photos**, drop files anywhere on the page, or paste with Ctrl/Cmd + V.
2. **Pick a layout** in the side panel and set the paper size, margins and spacing.
3. **Refine.** Click a photo (double-click in Free mode) to crop, rotate, adjust or caption it. Tick photos in the film strip to apply batch adjustments or freeform sizes to a selection.
4. **Print or export.** In the print dialog choose **Actual size / 100%** with margins set to **None**, so the millimetres on screen are the millimetres on paper.

### Freeform shortcuts

| Action | How |
|---|---|
| Move / resize | Drag a photo · drag a handle (corners keep proportions, **Shift** stretches) |
| Multi-select | **Shift**-click, drag a box on empty paper, or **Ctrl/Cmd + A** |
| Nudge | Arrow keys: 1 mm, or 10 mm with **Shift** |
| Temporarily disable snapping | Hold **Alt** while dragging |
| Undo / redo | **Ctrl/Cmd + Z** / **Ctrl/Cmd + Shift + Z** |
| Remove from sheet | **Delete** (bring it back from the film strip) |
| Edit photo | Double-click |

## Run locally

SNAPSHEET is a static site with no framework and no runtime dependencies. Any static file server works:

```sh
git clone https://github.com/LiveSparks/snapsheet.git
cd snapsheet
python -m http.server 8000        # or: npx serve .
```

Then open <http://localhost:8000>.

### Project layout

```
src/
  index.html        page structure and controls
  styles.css        visual design and responsive layout
  js/               ordered modules, concatenated into app.js
    05-import-pipeline.js    decoding (incl. HEIC), thumbnails
    06-layout-engines.js     flow / polaroid / grid packing
    07-rendering-pages.js    on-screen sheets and cut guides
    09-editor-modal.js       per-photo crop and adjustments
    10-export-print.js       high-dpi rendering, PDF/PNG/JPG, print
    11a-freeform.js          freeform canvas: snapping, sizing, alignment
    13-persistence.js        IndexedDB save / restore
scripts/build.mjs   copies src/ to the repo root and bundles app.js
```

After editing anything in `src/`, run `npm run build` (Node 20.11+) to regenerate the root `index.html`, `styles.css` and `app.js` that get deployed.

### Deployment

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which builds the site and publishes it to GitHub Pages.

## Under the hood

- Layouts are computed in millimetres and rendered on a `<canvas>` at the chosen dpi, so a 62 mm polaroid prints at 62 mm.
- HEIC/HEIF decoding uses [libheif-js](https://github.com/catdad-experiments/libheif-js), with [heic2any](https://github.com/alexcorvi/heic2any) as a fallback. PDFs are built with [jsPDF](https://github.com/parallax/jsPDF). All three, plus Google Fonts, load from jsDelivr and Google at runtime, so HEIC import, PDF export and the typefaces need an internet connection.
- Exports render one sheet at a time and free each canvas immediately, so long runs stay within browser memory limits. Very high dpi settings can still exceed what a browser can draw; the app tells you when that happens.

## Caveats

- **LLM-generated code:** see the caution note above. Review the code before relying on it for anything important.
- Browser storage can be cleared by the browser or by you. Treat saved projects as a convenience, not a backup, and keep your original photos.
- Printer drivers vary. Always print one test sheet at actual size and measure it before a big batch.

## License

[MIT](LICENSE) © 2026 Ravi Kharb. Provided "as is", without warranty of any kind (see the caution note above).
