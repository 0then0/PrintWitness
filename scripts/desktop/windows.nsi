Unicode True
!include "MUI2.nsh"
Name "PrintWitness"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\PrintWitness"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${APP_DIR}\icon.ico"
UninstallIcon "${APP_DIR}\icon.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  IfFileExists "$LOCALAPPDATA\PrintWitness\instance.json" 0 +3
  MessageBox MB_OK|MB_ICONEXCLAMATION "Quit PrintWitness before installing. If it previously crashed, launch it once and quit to clear its stale state."
  Abort
FunctionEnd
Function un.onInit
  IfFileExists "$LOCALAPPDATA\PrintWitness\instance.json" 0 +3
  MessageBox MB_OK|MB_ICONEXCLAMATION "Quit PrintWitness before uninstalling."
  Abort
FunctionEnd
Section "PrintWitness"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\PrintWitness"
  CreateShortcut "$SMPROGRAMS\PrintWitness\PrintWitness.lnk" "$INSTDIR\PrintWitness.exe"
  CreateShortcut "$SMPROGRAMS\PrintWitness\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\PrintWitness.lnk" "$INSTDIR\PrintWitness.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintWitness" "DisplayName" "PrintWitness"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintWitness" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintWitness" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintWitness" "DisplayIcon" "$INSTDIR\PrintWitness.exe"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\PrintWitness.lnk"
  Delete "$SMPROGRAMS\PrintWitness\PrintWitness.lnk"
  Delete "$SMPROGRAMS\PrintWitness\Uninstall.lnk"
  RMDir "$SMPROGRAMS\PrintWitness"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrintWitness"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
