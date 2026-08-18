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
- Automatically speaks with `expo-speech`; the speaker button replays it.
- Plays Wave/Greet on opening, Talk/Speak while speaking, and Idle otherwise.
- Falls back to gentle bob/turn motion when the GLB has no animation clips.
- If the replacement model cannot load, the greeting remains usable and shows a safe 2D placeholder.

Because version 1.2 adds native location, speech, and GL support, build a fresh APK once after pulling this feature. Later GLB-only changes can be published through the normal preview update channel.
