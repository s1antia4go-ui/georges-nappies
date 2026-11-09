@echo off
rem Builds and signs GeorgesNappies.apk, then copies it into the website folder.
rem Uses short (no-space) paths because the Android tools break on spaces.
setlocal
set "L=C:\Users\SANTIA~1\AppData\Local"
rem Files created from inside the packaged Claude app really live in its LocalCache.
if not exist "%L%\GeorgesNappies\android-build" set "L=%L%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local"
echo Using tools in %L%
for /d %%J in ("%ProgramFiles%\Microsoft\jdk-17*") do set "JAVA_HOME=%%~sJ"
set "ANDROID_HOME=%L%\GeorgesNappies\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "B=%L%\GeorgesNappies\android-build"
set "SIGN=%L%\GeorgesNappies\android-signing"
set "T=%ANDROID_HOME%\build-tools\34.0.0"

cd /d "%B%\android" || goto :fail
call .\gradlew.bat assembleRelease --no-daemon -q || goto :fail
cd /d "%B%" || goto :fail
"%T%\zipalign.exe" -f 4 android\app\build\outputs\apk\release\app-release-unsigned.apk aligned.apk || goto :fail
call "%T%\apksigner.bat" sign --ks "%SIGN%\georges-nappies.keystore" --ks-pass "file:%SIGN%\keystore-password.txt" --out GeorgesNappies.apk aligned.apk || goto :fail
call "%T%\apksigner.bat" verify GeorgesNappies.apk || goto :fail
copy /y GeorgesNappies.apk "%~dp0..\backend\site\GeorgesNappies.apk" >nul || goto :fail
echo APK-BUILD-OK
exit /b 0

:fail
echo APK-BUILD-FAILED
exit /b 1
