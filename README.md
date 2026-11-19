# android branch: Android test-IME spike

Throwaway spike. An Android emulator on a GitHub-hosted Ubuntu runner runs Chrome. A small test input method
(`android/ime`) makes InputConnection calls (setComposingText, commitText, deleteSurroundingText, sendKeyEvent, ...)
from adb broadcasts, so the page gets real Android Chrome input events.

The test IME and the runner ideas are adapted from Slate's device harness
(https://github.com/ianstormtaylor/slate, `playwright/devices/android/`, MIT License, Copyright (c) Ian Storm Taylor).
