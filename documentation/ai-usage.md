# Using AI with Web Whisper (Vulnerability + Clarity)

Web Whisper is built for dictation. That makes it a great place to think out
loud while you work with AI. The quality of what you get back is tightly
coupled to how open and specific you are. If you only describe the outcome
you want, the AI has to guess the rest. If you share your internal dialog,
you get better help and you learn where your mental model is wrong.

## A quick model: levels of openness

1. **Search-query mode**: short, outcome-only prompts. Fast, but shallow.
2. **Context mode**: goals + constraints + what you already tried.
3. **Vulnerability mode**: the above plus the real confusion, frustration,
   and the "I do not get this part" bits you might hide with other humans.

Level 3 is where AI becomes most helpful. It surfaces the assumptions you
didn't even realize you were making.

## Why vulnerability helps

When you are confused, filtered language hides the real problem. It also hides
the emotion that signals where your model is breaking. Letting that out gives
the AI a better map of what you actually need help with. It also forces you to
state what you believed to be true, which is often the thing that is wrong.

If you are dictating in a room with other people, you will naturally filter.
Try to capture the raw version first, then edit it into something public.

## Practice: flow, then refine

- **Flow**: talk or type as if you are writing for yourself. Be honest about
  what feels confusing or broken. This is not the place to be polished.
- **Refine**: edit the transcript into a crisp request when you want to share
  it with others or turn it into an actionable task list.

Web Whisper is designed to support that flow step. Use it as a safe space.

## Example from this project: the chunk playback confusion

There is a concrete example in this repo where passion and persistence led to
the real fix.

**What I thought was happening**
- Each chunk was assumed to be a contiguous slice of audio.
- So "play chunk 1" should sound like the first few seconds.

**What was actually happening**
- The capture path used the **MediaRecorder API** with `audio/mp4` fragments
  (AAC inside an MP4/MPEG-4 container).
- MP4 fragments are **timestamped container pieces**, not guaranteed to be
  independent clips.
- Playback order is defined by timestamps (PTS/DTS), not just blob order.
  A single fragment can overlap earlier audio or depend on prior context.

**The fix**
- Move to a **PCM-first capture path** using the **Web Audio API**
  (`AudioContext` + `ScriptProcessorNode`/`AudioWorklet`).
- Use PCM sample counts as the source of truth for timing.
- Encode PCM to MP3 with **Lame.js** for storage and playback.

Once the real technology names were clear, the mental model snapped into
place and the design shifted accordingly.

Related reading:
- `documentation/technology.md`
- `documentation/pcm-walkthrough.md`
- `documentation/ZZ_history/20260115_back-to-the-drawing-board.md`

## Language notes

Strong language can be a sign of intensity and honesty. For readability, the
spec prompt logs have been sanitized in place. If you want the raw transcript,
Git history preserves it.

## Closing thought

If you want better AI outputs, get more honest about your inputs. The point is
not to be polite. The point is to be clear about what is really happening in
your head.
