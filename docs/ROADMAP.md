# Roadmap

What is open, grouped by theme, not ranked. Each item comes from a limitation or an unfinished experiment recorded in
[ARCHITECTURE.md](ARCHITECTURE.md), [eval-harness-design.md](eval-harness-design.md) or the [changelog](../CHANGELOG.md); contributions
are welcome (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Streaming and engine work

- **A better voice engine than the browser's speech synthesis.** The browser voice is a placeholder. tiny-tts runs as an
  optional engine (`?tts=tiny`); its evaluation is in [eval/tts/README.md](../eval/tts/README.md): faster than real time and
  under 100 MB, but it takes 2.2 to 3.7 s to load (target 1.5 s), nobody has judged the voice yet, and its model weights have
  no license, so it cannot ship. Open: a listening verdict, the license from its author, a lighter export, and the
  questions at the end of that page. The start delay of the browser voice was 0.8 to 2 s in the gap experiment.
- **Let the speech queue hand the next utterance to an engine that can synthesize ahead.** With tiny-tts, no first-utterance
  wait gives the first sound 0.53 s sooner but leaves 0.87 s of silence after the first sentence, because the queue hands
  over the rest only when the first utterance has ended (eval/tts/README.md, "Inside Nutq").
- **Better Linux system voices (speech-dispatcher), to research.** Firefox on Linux only has robotic system voices.
- **Streaming speech for latency**, whether from a new engine or a cloud voice, sentence by sentence as the answer arrives.
- **Continuous listening and local barge-in.** Today listening is tap to start and tap to stop, and a tap stops the speech.
  Listening without a tap, and interrupting the agent by voice with the detection done in the browser, are the next steps in the
  interaction model.
- **The Moonshine dependency.** Its upstream source repository has been archived in favor of a separate project called
  "Moonshine Voice". What that means for long-term support needs to be understood, or alternatives evaluated.
- **An embeddable widget.** Packaging Nutq as a component other pages can include, once the interaction model and the voice
  engine settle.

## Platform testing

- **Test on macOS and Safari.** They are untested. [TESTING_PLATFORMS.md](TESTING_PLATFORMS.md) has the results so far and a ten-minute manual checklist; results
  from other systems are the most useful contribution here.
- **A cross-origin-isolated deployment** (COOP and COEP headers) is untested. ONNX Runtime 1.14.0 would then ask for its threaded
  wasm variants, which are not bundled.
- **ZeroClaw versions.** Nutq was checked against one ZeroClaw commit (see the README). Other versions, and whether a missing
  `schema_version = 3` explains the model field reading back as `<unset>`, have not been tested.
- **A speech-model load progress bar** would need the loader to expose progress, which the current one does not
  (`InferenceSession.create` takes a URL); fetching the weights in the page and handing them over as bytes would allow it.

## Accuracy levers

- **Commit seams:** where one utterance is cut into several commits to the model is the next lever recorded for word error rate.
- **Calibrating the voice detector's thresholds and the pre-roll length.** Both are starting points, not tuned values.
- **Chrome's microphone processing** (echo cancellation, noise suppression, gain) as a cause of run-to-run variation is untested, as
  is the 44.1 kHz capture rate Chrome reports, which is resampled downstream.
- **More pause recordings from more speakers.** The end-of-turn wait was tuned on 12 pause recordings by one speaker, and most of
  its cuts come from one recording, so the cut rate is a result for those takes, not a general one.

## Evaluation

- **Answer correctness and intent preservation** are specified in the design (section 5.3 and 5.4) but not built: no judge code
  exists under `eval/runner`, and which model should judge is undecided.
- **Pass and fail thresholds** are left until enough baseline numbers exist.
- **Recorded test audio** is not in the repository, so a contributor has to record their own (`eval/wer/record.sh`) to run the
  accuracy drivers.
