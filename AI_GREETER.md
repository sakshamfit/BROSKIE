# +one AI Greeter — replacing the character

The complete greeting interface ships with a small placeholder robot. Replace exactly this file with your character:

```text
app/assets/ai-greeter.glb
```

Do **not** rename the file or change the import. The renderer automatically recentres and scales the model.

## PowerShell replacement

From your local clone:

```powershell
cd "E:\broskie\BROSKIE"
Copy-Item "C:\path\to\your-character.glb" ".\app\assets\ai-greeter.glb" -Force

git add .\app\assets\ai-greeter.glb
git commit -m "Replace AI greeter character"
git push origin main
```

## Animation playback

The GLB animation is the source of truth. The renderer does not map bones, apply a base pose, retarget tracks, or generate procedural gestures.

The current Avaturn file contains one 44.77-second clip named `Animation`. Web and native both select that sole clip, play it through `THREE.AnimationMixer`, loop it continuously, and update the mixer on every rendered frame. Speech runs independently and never changes skeleton transforms.

If a future GLB contains multiple clips, the renderer prefers `Action.004` when present for backward compatibility and otherwise plays the first exported clip. Prepare the desired default animation order inside the GLB before replacing the asset.

## Export recommendations

- One self-contained binary `.glb` with embedded textures.
- Standard glTF 2.0 materials and animations.
- Avoid Draco/KTX2 compression unless decoder support is added.
- Keep the file under roughly 15 MB for fast daily loading.
- Put the character near the model origin; automatic bounds correction handles normal offsets and scale differences.

## Behaviour already implemented

- Appears once per local calendar day after authentication.
- Requests foreground device location and reads current weather from Open-Meteo.
- Greets by time of day and first name.
- Announces unread messages, message requests, colleague requests, and community requests.
- Automatically speaks exactly once with a preferred feminine English voice.
- Renders the character as the centred hero in a dedicated full-screen stage, with safe-area-aware greeting text above and a compact translucent speech surface in front near the bottom.
- Splits the spoken briefing into greeting, weather, notifications and finale segments.
- Plays the original exported GLB animation continuously and independently from speech.
- On native, resolves Metro's bundled asset with `expo-asset`, reads the downloaded GLB bytes with `expo-file-system`, and parses them directly so Android never falls back to the placeholder because of a numeric `require()` URI.
- Closes itself after the final spoken line; there is no replay/speaker control.
- Never rewrites the bind pose or manually rotates skeleton bones.
- If the replacement model cannot load, the greeting remains usable and shows a safe 2D placeholder.

Because version 1.2 adds native location, speech, and GL support, build a fresh APK once after pulling this feature. Later GLB-only changes can be published through the normal preview update channel.
