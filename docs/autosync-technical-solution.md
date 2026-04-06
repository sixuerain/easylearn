# Autosync Technical Solution

## Problem

The original autosync pipeline tried to align two imperfect text sources directly:
- **OCR** (image → text): misses characters, produces spurious ones
- **Whisper** (audio → text): hallucinates, repeats text at chunk boundaries

Errors in both sources compounded through anchor-based alignment, causing progressive timing drift. Additionally, the HTML5 `<audio>` element cannot seek accurately in MP3 files — the browser estimates byte offsets from bitrate, and the error accumulates over time.

## Architecture

### Two-Stage Pipeline

```
Stage 1: Audio → Whisper → TranscriptWord[] (timing source of truth)
Stage 2: TranscriptWord[] ↔ OCR Word[] via edit distance (position source of truth)
```

**Stage 1** produces the canonical timeline. Each CJK character gets its own `TranscriptWord` record with `startMs`/`endMs` from Whisper. Overlapping/hallucinated chunks are deduplicated before building the timeline.

**Stage 2** links transcript characters to OCR bounding boxes using Wagner-Fischer edit distance with backtracking. This gives optimal global alignment — unlike the old anchor-based approach which was greedy and propagated errors.

### Data Model

```
TranscriptWord (Whisper output)
├── text, startMs, endMs, orderIdx  ← timing from Whisper
├── pageId                          ← assigned page (from alignment)
├── ocrWordId (nullable)            ← link to OCR Word for bounding box
└── matchConf                       ← 1.0 = exact, 0.5 = substitution

Word (OCR output)
├── text, x, y, w, h, orderIdx     ← bounding box from OCR
└── transcriptMatch[]               ← reverse link to TranscriptWord
```

Words only in audio (no bounding box): `ocrWordId = null`, character shows in text banner but no highlight on page image.

Words only in OCR (no timing): no linked `TranscriptWord`, rendered as transparent overlay.

### Web Audio API

The HTML5 `<audio>` element uses frame-based seeking for MP3 files, which drifts by seconds over long files. The Reader uses the Web Audio API instead:

1. `fetch()` + `decodeAudioData()` decodes the entire MP3 into a raw PCM `AudioBuffer`
2. Seeking creates a new `AudioBufferSourceNode` with `source.start(0, offsetSeconds)` — sample-accurate
3. Time tracking uses `AudioContext.currentTime` + `requestAnimationFrame`

### Edit Distance Alignment

For CJK text, both Whisper and OCR produce individual characters, making edit distance natural:

- **Match** (chars equal): link with confidence 1.0
- **Substitution** (chars differ): link with confidence 0.5 (OCR/Whisper error)
- **Insertion** (Whisper has char, OCR doesn't): `ocrWordId` stays null
- **Deletion** (OCR has char, Whisper doesn't): OCR word gets no transcript link

Complexity: O(n×m) where n, m are typically 20–100 chars per page — trivially fast.

## Files

| File | Role |
|------|------|
| `prisma/schema.prisma` | `TranscriptWord` model and relations |
| `app/api/books/[id]/autosync/route.ts` | Two-stage pipeline (Whisper → edit distance) |
| `app/books/[id]/read/Reader.tsx` | Web Audio API + transcript-based playback |
| `app/books/[id]/read/page.tsx` | Server component fetching transcript data |

## Backward Compatibility

- Legacy `WordTiming` records are still written during autosync for books using the manual sync tool
- Reader falls back to `Word` + `WordTiming` when no `TranscriptWord` records exist
- Old books continue to work without re-running autosync
