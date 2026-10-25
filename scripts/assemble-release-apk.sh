#!/usr/bin/env bash
# Standalone release APK: embedded Hermes bundle, no Metro server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export NODE_ENV=production

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JDK 17 not found at $JAVA_HOME" >&2
  exit 1
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ -x "$SDKMANAGER" ]]; then
  yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
  "$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
    "platform-tools" \
    "platforms;android-37.0" \
    "build-tools;37.0.0" \
    "ndk;27.1.12297006"
fi

if [[ ! -d android ]]; then
  npx expo prebuild -p android --no-install
fi

python3 scripts/apply-release-signing.py

PROP="android/gradle.properties"
if grep -q '^reactNativeArchitectures=' "$PROP"; then
  sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' "$PROP"
else
  echo 'reactNativeArchitectures=arm64-v8a' >> "$PROP"
fi
if ! grep -q '^org.gradle.jvmargs=' "$PROP"; then
  echo 'org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8' >> "$PROP"
fi
if ! grep -q '^hermesEnabled=' "$PROP"; then
  echo 'hermesEnabled=true' >> "$PROP"
fi

cd android
chmod +x ./gradlew
./gradlew assembleRelease --no-daemon

APK="app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  echo "assembleRelease did not produce $APK" >&2
  exit 1
fi

VERSION="$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/opencode-mobile-v${VERSION}.apk"
cp "$APK" "$OUT"

unzip -l "$OUT" > /tmp/apk-contents.txt
if ! grep -q 'index.android.bundle' /tmp/apk-contents.txt; then
  echo "APK is missing index.android.bundle" >&2
  head -50 /tmp/apk-contents.txt >&2
  exit 1
fi

echo "APK $OUT"
ls -lh "$OUT"
unzip -l "$OUT" | grep -E 'index.android.bundle|libhermes|libreactnative' || true
