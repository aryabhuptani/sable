#!/usr/bin/env python3

import argparse
import json
import os
import sys
import time


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Transcribe a voice note locally.")
    parser.add_argument("--input", required=True, help="Path to the input audio file")
    parser.add_argument("--model", default="base.en", help="faster-whisper model name")
    parser.add_argument("--language", default="en", help="Language code")
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size")
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="CTranslate2 compute type (for example: int8, float16, float32)",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Require --model to resolve to an existing local path instead of downloading.",
    )
    return parser


def normalize_transcript(text: str) -> str:
    return " ".join(text.split()).strip()


def resolve_model_source(model: str, local_only: bool) -> str:
    expanded = os.path.abspath(os.path.expanduser(model))

    if os.path.exists(expanded):
        return expanded

    if local_only:
        raise FileNotFoundError(
            "Local voice model not found. "
            f"Expected an existing path for --model, got: {model}"
        )

    return model


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as error:  # pragma: no cover
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "faster-whisper is not installed. "
                        "Install requirements-stt.txt before using voice notes. "
                        f"Import error: {error}"
                    ),
                }
            )
        )
        return 1

    started_at = time.perf_counter()

    try:
        model_source = resolve_model_source(args.model, args.local_only)
        model = WhisperModel(model_source, device="cpu", compute_type=args.compute_type)
        segments, info = model.transcribe(
            args.input,
            language=args.language,
            beam_size=args.beam_size,
            vad_filter=True,
        )

        transcript = normalize_transcript(" ".join(segment.text for segment in segments))
        elapsed = time.perf_counter() - started_at

        print(
            json.dumps(
                {
                    "ok": True,
                    "backend": "faster-whisper",
                    "model": model_source,
                    "language": args.language,
                    "duration_sec": getattr(info, "duration", None),
                    "elapsed_sec": elapsed,
                    "transcript": transcript,
                }
            )
        )
        return 0
    except Exception as error:  # pragma: no cover
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
