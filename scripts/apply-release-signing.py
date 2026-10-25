#!/usr/bin/env python3
"""Point the Expo release build at the sideload keystore."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRADLE = ROOT / "android" / "app" / "build.gradle"
MARKER = "opencodeReleaseSigning"
SNIPPET = """
// opencodeReleaseSigning — sideload key, not a Play upload key.
android {
    signingConfigs {
        release {
            storeFile rootProject.file("../keystore/opencode-mobile-release.keystore")
            storePassword "opencode-mobile"
            keyAlias "opencode"
            keyPassword "opencode-mobile"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
"""


def main() -> None:
    text = GRADLE.read_text()
    if MARKER not in text:
        GRADLE.write_text(text.rstrip() + "\n" + SNIPPET)
    print(f"signing config ready: {GRADLE}")


if __name__ == "__main__":
    main()
