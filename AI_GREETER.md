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

## Animation clip names

The character controller searches animation names case-insensitively:

| Behaviour | Recognised words in animation clip name |
|---|---|
| Idle | `idle`, `breath`, `loop` |
| Greeting wave | `wave`, `greet`, `hello` |
| Speaking | `talk`, `speak`, `voice`, `mouth` |

Examples: `Idle`, `Wave_Hand`, and `Talking` work automatically. If clips use different names, rename them in Blender before export or add their keywords to `AIGreeterModel.web.js` and `AIGreeterModel.native.js`.

The currently uploaded Avaturn file contains only a one-frame pose animation, so +one now creates the visible body/head/hand gestures procedurally from its skeleton. True mouth movement or facial emotion additionally requires facial morph targets/blendshapes in the exported GLB; the current file contains none.

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
- Splits the briefing into greeting, weather, notifications and finale segments.
- Synchronises skeleton gestures to those segments: wave, present the weather, count notifications and open-arm finale.
- Closes itself after the final spoken line; there is no replay/speaker control.
- Plays matching named GLB clips when real multi-frame clips exist; otherwise it procedurally drives Avaturn-compatible Head, Spine, Arm, ForeArm and Hand bones.
- If the replacement model cannot load, the greeting remains usable and shows a safe 2D placeholder.

Because version 1.2 adds native location, speech, and GL support, build a fresh APK once after pulling this feature. Later GLB-only changes can be published through the normal preview update channel.
