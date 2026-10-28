; Refuse to close/kill a running Studio. User must save edits and let its queue finish.
!macro customInit
  !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Save your edits, finish or cancel queued work, then quit StudioAI before installing. No running job has been stopped." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend

; Recheck immediately before file replacement; never invoke the default kill path.
!macro customCheckAppRunning
  !insertmacro customInit
!macroend
