# tr-file — 60-second promo: scene plan

PRD 016, Section 3.2. A promotional cut of the major features, built the same way as the tutorial video (Section 3.1): pictures of tr-file in a browser, one highlight each, and subtitle-style captions — no voice, no music, no branding. Remote servers and the desktop app are left out.

**15 scenes · 60 s** · every picture is a frame the tutorial video already has (`video/images/`); the last is the F1 cheatsheet, close up (Section 3.2.1).

> Section 3.2 also repeats "Length should be relatively short (5 minutes)" from Section 3.1; this plan follows its first line, **60 s**.

## How it differs from the tutorial video

- **One caption, one highlight.** Each scene makes one point: a single caption (the first and last scenes two), the highlight already on.
- **A quicker hold.** 1.3 s for the picture before its caption, 0.5 s after it — against 2.4 s and 1.2 s in the tutorial.
- **The same reading pace.** Captions stay up for their length at 17 characters a second, never less than 1.5 s; at most 2 lines of 42 characters.
- **No chapters or feature names on screen.** The picture fills the frame edge to edge, and the caption sits over its bottom edge, on its dark band; there is no title band and no keycaps. Scenes cut, the highlight fades in over the first 0.4 s.
- **Same size.** 1920 × 1080, 30 fps, silent; captions also as an `.srt`.

## Scenes

| # | at | for | feature | caption | picture | highlight |
|---|---:|---:|---|---|---|---|
| P01 | 0:00.0 | 5.1 s | Hello | Meet tr-file. ⏵ A file manager in your browser. | S01-0 | None — the whole window. |
| P02 | 0:05.1 | 3.3 s | Two panels | Two panels, side by side. | S02-2 | Both panels. |
| P03 | 0:08.4 | 5.2 s | The keyboard | Midnight Commander’s keys — F5 copies / to the other panel. | S14-1 | F5 / F6 in the function-key bar, and the other panel’s folder. |
| P04 | 0:13.6 | 3.6 s | Command palette | Every command, one search away. | S29-1 | The palette. |
| P05 | 0:17.2 | 4.2 s | Tabs and splits | Tabs, splits, as many panels as you like. | S11-1 | The split buttons and the third panel. |
| P06 | 0:21.4 | 3.9 s | Pictures | Thumbnails, and a viewer that zooms. | S23-2 | The zoomed picture (its zoom controls sit under the caption). |
| P07 | 0:25.3 | 3.6 s | The editor | Edit text, with syntax colours. | S25-1 | The code editor. |
| P08 | 0:28.9 | 3.6 s | JSON | JSON as a tree you can search. | S26-1 | The search and its match. |
| P09 | 0:32.5 | 3.3 s | CSV | CSV as a real spreadsheet. | S27-1 | The sheet. |
| P10 | 0:35.8 | 4.1 s | Zip archives | Look inside a zip without unpacking it. | S22-1 | The listing inside the zip. |
| P11 | 0:39.9 | 3.8 s | Git | Git built in: diff, stage, commit. | S31-2 | The diff and the pane’s changes. |
| P12 | 0:43.7 | 3.3 s | Disk Usage | See where your space went. | S32-1 | The pie. |
| P13 | 0:47.0 | 3.6 s | Task Manager | And what your machine is doing. | S34-1 | The resources and the CPU graph. |
| P14 | 0:50.6 | 4.2 s | Light and dark | Dark or light. Every key yours to change. | S37-1 | The theme button. |
| P15 | 0:54.8 | 4.8 s | Every key | Press F1 for every key. ⏵ tr-file | S38b-1 | The cheatsheet, close up — F1 opens it over the window. |

A `/` is a caption's line break, a ⏵ the next caption of the same scene.

## Caption timings

| at | for | caption |
|---:|---:|---|
| 0:01.3 | 1.5 s | Meet tr-file. |
| 0:02.8 | 1.8 s | A file manager in your browser. |
| 0:06.4 | 1.5 s | Two panels, side by side. |
| 0:09.7 | 3.4 s | Midnight Commander’s keys — F5 copies / to the other panel. |
| 0:14.9 | 1.8 s | Every command, one search away. |
| 0:18.5 | 2.4 s | Tabs, splits, as many panels as you like. |
| 0:22.7 | 2.1 s | Thumbnails, and a viewer that zooms. |
| 0:26.6 | 1.8 s | Edit text, with syntax colours. |
| 0:30.2 | 1.8 s | JSON as a tree you can search. |
| 0:33.8 | 1.5 s | CSV as a real spreadsheet. |
| 0:37.1 | 2.3 s | Look inside a zip without unpacking it. |
| 0:41.2 | 2.0 s | Git built in: diff, stage, commit. |
| 0:45.0 | 1.5 s | See where your space went. |
| 0:48.3 | 1.8 s | And what your machine is doing. |
| 0:51.9 | 2.4 s | Dark or light. Every key yours to change. |
| 0:56.1 | 1.5 s | Press F1 for every key. |
| 0:57.6 | 1.5 s | tr-file |

## Built

In `video/`, from the frames listed above (no new captures) and this plan's times: `promo.pptx` (one slide per scene, each advancing by itself, the highlight fading in, captions coming and going), `promo.mp4` (1920 × 1080, 30 fps, silent, 59.6 s) and `promo.srt` (the captions).
