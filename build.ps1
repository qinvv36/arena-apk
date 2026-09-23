$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$env:JAVA_HOME = "D:\jdk-21"
$env:PATH = "D:\jdk-21\bin;" + $env:PATH

$SDK = "C:\Users\29839\AppData\Local\Android\Sdk"
$BUILD_TOOLS = "$SDK\build-tools\34.0.0"
$PLATFORM_JAR = "$SDK\platforms\android-34\android.jar"

Write-Host "--- 1. Compile Resources with AAPT2 ---"
& "$BUILD_TOOLS\aapt2.exe" compile --dir res -o build\compiled_res.flata

Write-Host "--- 2. Link APK with AAPT2 ---"
& "$BUILD_TOOLS\aapt2.exe" link `
    -I $PLATFORM_JAR `
    --manifest AndroidManifest.xml `
    -o build\app-unsigned.apk `
    build\compiled_res.flata `
    -A assets `
    --auto-add-overlay `
    --min-sdk-version 33 `
    --target-sdk-version 34

Write-Host "--- 3. Compile Java sources ---"
if (Test-Path "build\obj") { Remove-Item -Recurse -Force "build\obj" }
New-Item -ItemType Directory -Force -Path "build\obj" | Out-Null
& "D:\jdk-21\bin\javac.exe" -source 17 -target 17 -cp $PLATFORM_JAR -d build\obj src\ai\arena\app\MainActivity.java

Write-Host "--- 4. Run D8 Dexer ---"
if (Test-Path "build\dex") { Remove-Item -Recurse -Force "build\dex" }
New-Item -ItemType Directory -Force -Path "build\dex" | Out-Null
$classFiles = Get-ChildItem -Path "build\obj\ai\arena\app\*.class" | ForEach-Object { $_.FullName }
& "$BUILD_TOOLS\d8.bat" --min-api 33 --output build\dex $classFiles

Write-Host "--- 5. Add classes.dex to APK ---"
Push-Location build\dex
& "D:\jdk-21\bin\jar.exe" uvf ..\app-unsigned.apk classes.dex
Pop-Location

Write-Host "--- 6. Zipalign ---"
if (Test-Path "build\app-aligned.apk") { Remove-Item -Force "build\app-aligned.apk" }
& "$BUILD_TOOLS\zipalign.exe" -p -f 4 build\app-unsigned.apk build\app-aligned.apk

Write-Host "--- 7. Sign with apksigner ---"
& "$BUILD_TOOLS\apksigner.bat" sign `
    --ks arena.keystore `
    --ks-pass pass:arena123 `
    --key-pass pass:arena123 `
    --ks-key-alias arena `
    --out "D:\Arena_AI.apk" `
    build\app-aligned.apk

Write-Host "--- 8. Verify APK Signature ---"
& "$BUILD_TOOLS\apksigner.bat" verify -v "D:\Arena_AI.apk"

Write-Host "BUILD COMPLETED SUCCESSFULLY!"
