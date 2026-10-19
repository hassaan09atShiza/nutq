#!/usr/bin/env bash
# Linux only, for a machine with no speakers (such as a cloud container): records what the real Nutq page speaks to a
# WAV file. Chrome's Web Speech output goes through speech-dispatcher and espeak-ng into a PulseAudio null sink, and
# parec records that sink while deploy/page-check.mjs drives the page. The voice is espeak-ng's, not the voice a desktop
# browser uses (Google or Microsoft voices), so this shows that Nutq speaks and what it says, not how it sounds on a
# laptop.
#
#   deploy/capture-speech.sh out.wav --token-file deploy/.local/gateway-token --test-voice
#   deploy/capture-speech.sh out.wav --token-file deploy/.local/gateway-token --say question.wav
#
# Every option after out.wav goes to page-check.mjs. Needs pulseaudio, pulseaudio-utils, speech-dispatcher,
# speech-dispatcher-espeak-ng, espeak-ng and xvfb (Debian and Ubuntu package names), this repo's npm install, and
# Chrome in CHROME_BIN. Writes out.wav and, when ffmpeg is installed, out.trimmed.wav without the leading and trailing
# silence.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:?usage: capture-speech.sh out.wav [page-check.mjs options]}"
shift

for tool in pulseaudio pactl parec speech-dispatcher node; do
  command -v "$tool" >/dev/null || { echo "capture-speech: $tool is not installed" >&2; exit 2; }
done

# PulseAudio first. A speech-dispatcher that started before it cannot open audio ("Couldn't open pulse plugin") and
# stays broken (Chrome then reports synthesis-failed), so any running one is stopped and Chrome spawns a fresh one,
# which inherits PULSE_SERVER.
pulse_dir="${TMPDIR:-/tmp}/nutq-pulse-$(id -u)"
export PULSE_SERVER="unix:$pulse_dir/pulse/native"
if ! pactl info >/dev/null 2>&1; then
  mkdir -p "$pulse_dir"
  chmod 700 "$pulse_dir"
  XDG_RUNTIME_DIR="$pulse_dir" pulseaudio --daemonize=yes --exit-idle-time=-1
  for _ in $(seq 1 40); do pactl info >/dev/null 2>&1 && break; sleep 0.25; done
fi
pactl list short sinks | grep -q nutq_capture || pactl load-module module-null-sink sink_name=nutq_capture >/dev/null
pactl set-default-sink nutq_capture

if pgrep -x speech-dispatch >/dev/null; then # the process name is cut to 15 characters
  pkill -x speech-dispatch || true
  for _ in $(seq 1 12); do pgrep -x speech-dispatch >/dev/null || break; sleep 0.25; done
  pkill -9 -x speech-dispatch || true
fi

parec -d nutq_capture.monitor --file-format=wav "$out" &
rec=$!
trap 'kill "$rec" 2>/dev/null || true' EXIT

# Headless Chrome is not used: under Xvfb, a headed Chrome is the setup this was checked with.
run=(node "$here/page-check.mjs" --headed "$@")
if [ -z "${DISPLAY:-}" ]; then run=(xvfb-run -a "${run[@]}"); fi
set +e
"${run[@]}"
rc=$?
set -e

sleep 0.5
kill "$rec" 2>/dev/null || true
wait "$rec" 2>/dev/null || true
trap - EXIT

if command -v ffmpeg >/dev/null; then
  trim="silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.2"
  ffmpeg -hide_banner -loglevel error -y -i "$out" -af "$trim,areverse,$trim,areverse" "${out%.wav}.trimmed.wav"
  echo "capture-speech: wrote $out and ${out%.wav}.trimmed.wav"
else
  echo "capture-speech: wrote $out"
fi
exit "$rc"
